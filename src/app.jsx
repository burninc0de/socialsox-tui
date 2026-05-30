import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import chalk from 'chalk';
import {
  importLegacySocialSoxCredentials,
  loadConfig,
  loadSecrets,
  resetStoredData,
  saveConfig,
  saveSecrets,
} from './lib/config.js';
import { loadMedia } from './lib/media.js';
import { runCrosspost } from './lib/crosspost.js';

const FIELDS = [
  { key: 'message', label: 'Message' },
  { key: 'attachments', label: 'Media paths (comma-separated)' },
  { key: 'mastodonEnabled', label: 'Enable Mastodon [space]' },
  { key: 'mastodonInstance', label: 'Mastodon instance' },
  { key: 'mastodonToken', label: 'Mastodon token' },
  { key: 'xEnabled', label: 'Enable X [space]' },
  { key: 'xApiKey', label: 'X API key' },
  { key: 'xApiSecret', label: 'X API secret' },
  { key: 'xAccessToken', label: 'X access token' },
  { key: 'xAccessTokenSecret', label: 'X access token secret' },
  { key: 'blueskyEnabled', label: 'Enable Bluesky [space]' },
  { key: 'blueskyHandle', label: 'Bluesky handle' },
  { key: 'blueskyPassword', label: 'Bluesky app password' },
];

export function App({ resetConfig }) {
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('Loading...');
  const [results, setResults] = useState([]);

  const [form, setForm] = useState({
    message: '',
    attachments: '',
    mastodonEnabled: true,
    mastodonInstance: '',
    mastodonToken: '',
    xEnabled: true,
    xApiKey: '',
    xApiSecret: '',
    xAccessToken: '',
    xAccessTokenSecret: '',
    blueskyEnabled: true,
    blueskyHandle: '',
    blueskyPassword: '',
  });

  useEffect(() => {
    (async () => {
      try {
        if (resetConfig) {
          await resetStoredData();
        }

        const [config, secrets] = await Promise.all([loadConfig(), loadSecrets()]);
        setForm((prev) => ({
          ...prev,
          attachments: config.compose.lastAttachments || '',
          mastodonEnabled: !!config.mastodon.enabled,
          mastodonInstance: config.mastodon.instance || '',
          mastodonToken: secrets.mastodonToken || '',
          xEnabled: !!config.x.enabled,
          xApiKey: secrets.xApiKey || '',
          xApiSecret: secrets.xApiSecret || '',
          xAccessToken: secrets.xAccessToken || '',
          xAccessTokenSecret: secrets.xAccessTokenSecret || '',
          blueskyEnabled: !!config.bluesky.enabled,
          blueskyHandle: config.bluesky.handle || '',
          blueskyPassword: secrets.blueskyPassword || '',
        }));

        setStatus(
          resetConfig
            ? 'Config reset. Fill credentials and post.'
            : 'Ready. Press i to import desktop credentials, p to post.'
        );
      } catch (error) {
        setStatus(`Failed to load config: ${error.message}`);
      } finally {
        setBusy(false);
      }
    })();
  }, [resetConfig]);

  const selection = useMemo(() => FIELDS[cursor], [cursor]);

  useInput(async (input, key) => {
    if (busy) return;

    if (key.escape) {
      if (editing) {
        setEditing(false);
      } else {
        exit();
      }
      return;
    }

    if (!editing && input === 'q') {
      exit();
      return;
    }

    if (!editing && key.upArrow) {
      setCursor((c) => (c - 1 + FIELDS.length) % FIELDS.length);
      return;
    }

    if (!editing && key.downArrow) {
      setCursor((c) => (c + 1) % FIELDS.length);
      return;
    }

    if (!editing && input === 's') {
      setBusy(true);
      setStatus('Saving config...');
      try {
        await persistForm(form);
        setStatus('Saved config and credentials.');
      } catch (error) {
        setStatus(`Save failed: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!editing && input === 'i') {
      setBusy(true);
      setStatus('Importing SocialSox desktop credentials...');
      try {
        const imported = await importLegacySocialSoxCredentials();
        setForm((prev) => ({
          ...prev,
          mastodonEnabled: !!imported.config.mastodon.enabled,
          mastodonInstance: imported.config.mastodon.instance || '',
          mastodonToken: imported.secrets.mastodonToken || '',
          xEnabled: !!imported.config.x.enabled,
          xApiKey: imported.secrets.xApiKey || '',
          xApiSecret: imported.secrets.xApiSecret || '',
          xAccessToken: imported.secrets.xAccessToken || '',
          xAccessTokenSecret: imported.secrets.xAccessTokenSecret || '',
          blueskyEnabled: !!imported.config.bluesky.enabled,
          blueskyHandle: imported.config.bluesky.handle || '',
          blueskyPassword: imported.secrets.blueskyPassword || '',
        }));
        setStatus(`Imported desktop credentials from ${imported.importedFrom}`);
      } catch (error) {
        setStatus(`Import failed: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!editing && input === 'p') {
      setBusy(true);
      setStatus('Posting to enabled platforms...');
      setResults([]);
      try {
        await persistForm(form);
        const media = await loadMedia(form.attachments);
        const result = await runCrosspost({
          message: form.message,
          media,
          config: {
            mastodon: { enabled: form.mastodonEnabled, instance: form.mastodonInstance },
            x: { enabled: form.xEnabled },
            bluesky: { enabled: form.blueskyEnabled, handle: form.blueskyHandle },
            compose: { lastAttachments: form.attachments },
          },
          secrets: {
            mastodonToken: form.mastodonToken,
            xApiKey: form.xApiKey,
            xApiSecret: form.xApiSecret,
            xAccessToken: form.xAccessToken,
            xAccessTokenSecret: form.xAccessTokenSecret,
            blueskyPassword: form.blueskyPassword,
          },
        });
        setResults(result);

        const okCount = result.filter((r) => r.success).length;
        setStatus(`Finished: ${okCount}/${result.length} platforms succeeded.`);
      } catch (error) {
        setStatus(`Post failed: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!editing && input === ' ') {
      if (selection.key === 'mastodonEnabled' || selection.key === 'xEnabled' || selection.key === 'blueskyEnabled') {
        setForm((prev) => ({ ...prev, [selection.key]: !prev[selection.key] }));
      }
      return;
    }

    if (key.return && !editing) {
      if (selection.key.endsWith('Enabled')) {
        setForm((prev) => ({ ...prev, [selection.key]: !prev[selection.key] }));
      } else {
        setEditing(true);
      }
      return;
    }

    if (editing) {
      if (key.return) {
        setEditing(false);
        return;
      }
      if (key.backspace || key.delete) {
        setForm((prev) => ({ ...prev, [selection.key]: String(prev[selection.key]).slice(0, -1) }));
        return;
      }
      if (input) {
        setForm((prev) => ({ ...prev, [selection.key]: String(prev[selection.key]) + input }));
      }
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyanBright">SocialSox TUI - Crosspost Composer</Text>
      <Text dimColor>Arrows navigate | Enter edit | Space toggle | i import | s save | p post | q quit</Text>
      <Text>{status}</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.map((f, idx) => {
          const active = idx === cursor;
          const val = form[f.key];
          const shown = f.key.toLowerCase().includes('token') || f.key.toLowerCase().includes('secret') || f.key.includes('Password')
            ? mask(val)
            : formatValue(val);

          return (
            <Text key={f.key} color={active ? 'green' : undefined}>
              {active ? chalk.bold('>') : ' '} {f.label}: {shown}
              {active && editing ? '  [editing]' : ''}
            </Text>
          );
        })}
      </Box>

      {results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">Results</Text>
          {results.map((r) => (
            <Text key={r.platform} color={r.success ? 'green' : 'red'}>
              {r.platform}: {r.success ? r.value.url : r.error}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

function formatValue(value) {
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
  if (!value) return '<empty>';
  return String(value);
}

function mask(value) {
  if (!value) return '<empty>';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 6))}${value.slice(-3)}`;
}

async function persistForm(form) {
  await Promise.all([
    saveConfig({
      mastodon: { enabled: form.mastodonEnabled, instance: form.mastodonInstance },
      x: { enabled: form.xEnabled },
      bluesky: { enabled: form.blueskyEnabled, handle: form.blueskyHandle },
      compose: { lastAttachments: form.attachments },
    }),
    saveSecrets({
      mastodonToken: form.mastodonToken,
      xApiKey: form.xApiKey,
      xApiSecret: form.xApiSecret,
      xAccessToken: form.xAccessToken,
      xAccessTokenSecret: form.xAccessTokenSecret,
      blueskyPassword: form.blueskyPassword,
    }),
  ]);
}
