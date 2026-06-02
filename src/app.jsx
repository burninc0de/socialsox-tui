import path from 'node:path';
import fs from 'node:fs/promises';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import chalk from 'chalk';
import figlet from 'figlet';
import {
  getLegacyImportPath,
  hasLegacyImportFile,
  importLegacySocialSoxCredentials,
  loadConfig,
  loadSecretsWithMetadata,
  resetStoredData,
  saveConfig,
  saveSecrets,
} from './lib/config.js';
import { readClipboardImageMedia, writeTextToClipboard } from './lib/clipboard.js';
import { extractInlineImagesFromMessage, loadMedia } from './lib/media.js';
import { runCrosspost } from './lib/crosspost.js';
import { loadBuiltInThemes } from './lib/themes.js';

const POST_FIELDS = [
  { key: 'message', label: 'Message' },
  { key: 'attachments', label: 'Media paths (comma-separated)' },
  { key: 'mastodonEnabled', label: 'Enable Mastodon [space]' },
  { key: 'xEnabled', label: 'Enable X [space]' },
  { key: 'blueskyEnabled', label: 'Enable Bluesky [space]' },
];

const CONFIG_FIELDS = [
  { key: 'mastodonInstance', label: 'Mastodon instance' },
  { key: 'mastodonToken', label: 'Mastodon token' },
  { key: 'xApiKey', label: 'X API key' },
  { key: 'xApiSecret', label: 'X API secret' },
  { key: 'xAccessToken', label: 'X access token' },
  { key: 'xAccessTokenSecret', label: 'X access token secret' },
  { key: 'blueskyHandle', label: 'Bluesky handle' },
  { key: 'blueskyPassword', label: 'Bluesky app password' },
];

const SLASH_COMMANDS = [
  { name: '/mastodon', desc: 'Toggle Mastodon' },
  { name: '/x', desc: 'Toggle X' },
  { name: '/bluesky', desc: 'Toggle Bluesky' },
  { name: '/all', desc: 'Enable all platforms' },
  { name: '/none', desc: 'Disable all platforms' },
  { name: '/themes', desc: 'Open theme picker' },
  { name: '/system', desc: 'Use terminal-derived system theme' },
  { name: '/clear', desc: 'Clear message and inline media' },
  { name: '/post', desc: 'Submit post now' },

  { name: '/config', desc: 'Switch to config screen' },
];

const SOCIALSOX_BANNER = buildBanner();
const BRAILLE_SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const MESSAGE_PANEL_WIDTH = 72;
const LOADING_MESSAGES = [
  'sacrificing a byte to the API gods …',
  'negotiating with rate limits …',
  'arguing with OAuth again …',
  'launching message into the void …',
  'bribing the API with snacks …',
  'spinning up the content hamster …',
  'duct-taping the timelines together …',
  'delivering your post via carrier pigeon …',
  'compressing your hot take …',
  'brewing fresh latency …',
  'hand-carving your post in ASCII …',
  'teaching the server to cope …',
  'whispering sweet nothings to the API …',
  'smuggling your post past the algorithm …',
  'loading… because social media is a mistake …',
  'poking the timeline with a stick …',
  'wrangling APIs like feral cats …',
  'compressing existential dread …',
  'ignoring the touch grass alert …',
  'warming up the doomscroll engines …',
  'converting your thoughts to 280p …',
  'wrapping your content in bubble wrap …',
  'firing message through the tubes …',
  'packing your post parachute …',
  'convincing the server this isn’t spam …',
];
const DEFAULT_UI_THEME = buildSystemTheme();

export function App({ resetConfig }) {
  const { exit } = useApp();
  const [bootstrapped, setBootstrapped] = useState(false);
  const [screen, setScreen] = useState('post');
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('Loading...');
  const [results, setResults] = useState([]);
  const [inlineMedia, setInlineMedia] = useState([]);
  const [slashActive, setSlashActive] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [messageCursor, setMessageCursor] = useState(0);
  const [spinnerFrameIndex, setSpinnerFrameIndex] = useState(0);
  const [blinkOn, setBlinkOn] = useState(true);
  const lastInputAt = useRef(Date.now());
  const [secretStorageMode, setSecretStorageMode] = useState('keychain');
  const [themeCatalog, setThemeCatalog] = useState([]);
  const [themePreference, setThemePreference] = useState({ mode: 'system', name: '' });
  const [uiTheme, setUiTheme] = useState(DEFAULT_UI_THEME);

  const [form, setForm] = useState({
    message: '',
    attachments: '',
    mastodonEnabled: false,
    mastodonInstance: '',
    mastodonToken: '',
    xEnabled: false,
    xApiKey: '',
    xApiSecret: '',
    xAccessToken: '',
    xAccessTokenSecret: '',
    blueskyEnabled: false,
    blueskyHandle: '',
    blueskyPassword: '',
  });
  const formRef = useRef(form);
  useEffect(() => { formRef.current = form; }, [form]);
  useEffect(() => {
    setMessageCursor((c) => Math.min(c, String(form.message || '').length));
  }, [form.message]);

  useEffect(() => {
    if (!busy) {
      setSpinnerFrameIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setSpinnerFrameIndex((i) => (i + 1) % BRAILLE_SPINNER_FRAMES.length);
    }, 80);

    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (!editing) {
      setBlinkOn(true);
      return;
    }

    const timer = setInterval(() => {
      const idle = Date.now() - lastInputAt.current > 500;
      if (idle) {
        setBlinkOn((b) => !b);
      } else {
        setBlinkOn(true);
      }
    }, 800);

    return () => clearInterval(timer);
  }, [editing]);

  const slashQuery = form.message.startsWith('/') ? form.message.toLowerCase() : '';
  const filteredCommands = useMemo(
    () => getFilteredSlashCommands(slashQuery, themeCatalog),
    [slashQuery, themeCatalog]
  );

  useEffect(() => {
    (async () => {
      try {
        if (resetConfig) {
          await resetStoredData();
        }

        let [config, loadedSecrets] = await Promise.all([
          loadConfig(),
          loadSecretsWithMetadata(),
        ]);
        const availableThemes = loadBuiltInThemes();
        let secrets = loadedSecrets.secrets;
        setSecretStorageMode(loadedSecrets.storage);
        setThemeCatalog(availableThemes);

        const hasSavedData =
          !!config.mastodon.instance ||
          !!config.bluesky.handle ||
          Object.values(secrets).some(Boolean);

        let autoImported = false;
        if (!hasSavedData && (await hasLegacyImportFile())) {
          const imported = await importLegacySocialSoxCredentials();
          config = imported.config;
          secrets = imported.secrets;
          autoImported = true;
        }

        const normalizedTheme = normalizeThemePreference(config.theme, availableThemes);
        setThemePreference(normalizedTheme);
        setUiTheme(resolveUiTheme(normalizedTheme, availableThemes));

        setForm((prev) => ({
          ...prev,
          attachments: '',
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
          autoImported
            ? `Auto-loaded credentials from ${getLegacyImportPath()}`
            : resetConfig
              ? 'Config reset. Open CONFIG screen to set credentials.'
              : 'Ready.'
        );
      } catch (error) {
        setStatus(`Failed to load config: ${error.message}`);
      } finally {
        setBusy(false);
        setBootstrapped(true);
      }
    })();
  }, [resetConfig]);

  const activeFields = useMemo(() => (screen === 'config' ? CONFIG_FIELDS : POST_FIELDS), [screen]);
  const selection = useMemo(() => activeFields[cursor], [activeFields, cursor]);
  const busySpinner = BRAILLE_SPINNER_FRAMES[spinnerFrameIndex];
  const messageLayout = useMemo(
    () => buildWrappedLayout(String(form.message || ''), MESSAGE_PANEL_WIDTH),
    [form.message]
  );
  const mediaSummary = useMemo(
    () => renderMediaCount(form.attachments, inlineMedia),
    [form.attachments, inlineMedia]
  );
  const imageTagLine = useMemo(
    () => renderImageTagLine(form.attachments, inlineMedia, uiTheme),
    [form.attachments, inlineMedia, uiTheme]
  );
  const isMessageEditing = selection.key === 'message' && editing;
  const renderedMessageLines = useMemo(
    () => renderMessageLines(form.message, isMessageEditing ? messageCursor : -1, blinkOn, messageLayout, uiTheme),
    [form.message, isMessageEditing, messageCursor, blinkOn, messageLayout, uiTheme]
  );

  function switchScreen(nextScreen) {
    setScreen(nextScreen);
    if (nextScreen === 'post') {
      setCursor(0);
      setEditing(true);
      setMessageCursor(String(formRef.current.message || '').length);
      return;
    }
    setEditing(false);
    setCursor(0);
  }

  async function submitPost() {
    if (screen !== 'post') {
      setStatus('Switch to POST screen to publish (press m or tab).');
      return;
    }

    setBusy(true);
    setResults([]);

    const statusTimer = setInterval(() => {
      setStatus(LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]);
    }, 2000);

    try {
      const persistedStorage = await persistForm(form, themePreference);
      if (persistedStorage) setSecretStorageMode(persistedStorage);
      const media = await loadMedia(form.attachments, inlineMedia);
      const result = await runCrosspost({
        message: form.message,
        media,
        config: {
          mastodon: { enabled: form.mastodonEnabled, instance: form.mastodonInstance },
          x: { enabled: form.xEnabled },
          bluesky: { enabled: form.blueskyEnabled, handle: form.blueskyHandle },
      compose: {},
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
      clearInterval(statusTimer);
      setBusy(false);
    }
  }

  async function attachClipboardImage(source = 'manual') {
    if (screen !== 'post') {
      setStatus('Switch to POST screen to paste clipboard images.');
      return;
    }

    const fileAttachments = (form.attachments || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (fileAttachments.length + inlineMedia.length >= 4) {
      setStatus('Too many images. Max is 4 total (paths + pasted blobs).');
      return;
    }

    setBusy(true);
    setStatus('Reading clipboard image...');
    try {
      const media = await readClipboardImageMedia(inlineMedia.length + 1);
      if (!media) {
        if (source === 'manual') {
          setStatus('No image in clipboard. Copy an image first (wl-paste/xclip).');
        }
        return false;
      }
      setInlineMedia((prev) => [...prev, media]);
      setStatus(`Attached: ${media.name}`);
      return true;
    } catch (error) {
      if (source === 'manual') {
        setStatus(`Clipboard paste failed: ${error.message}`);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function executeSlashCommand(msg, selectedCommand = null) {
    const cmd = msg.split(/\s+/)[0].toLowerCase();

    const clearSlashComposer = () => {
      setSlashActive(false);
      setForm((prev) => ({ ...prev, message: '' }));
      setMessageCursor(0);
    };

    const openThemesSubmenu = () => {
      const opener = '/themes ';
      setForm((prev) => ({ ...prev, message: opener }));
      setMessageCursor(opener.length);
      setSlashActive(true);
      setSlashIndex(0);
      setStatus('Theme submenu: use arrows and Enter to select.');
    };

    const applyThemeSelection = async (nextPreference, label) => {
      clearSlashComposer();
      setThemePreference(nextPreference);
      setUiTheme(resolveUiTheme(nextPreference, themeCatalog));
      try {
        const existing = await loadConfig();
        await saveConfig({ ...existing, theme: nextPreference });
        setStatus(`${label} theme applied.`);
      } catch (error) {
        setStatus(`${label} theme applied for this session only (${error.message}).`);
      }
    };

    if (selectedCommand?.kind === 'theme-menu') {
      openThemesSubmenu();
      return;
    }

    if (selectedCommand?.kind === 'system') {
      await applyThemeSelection({ mode: 'system', name: '' }, 'System');
      return;
    }

    if (selectedCommand?.kind === 'manual') {
      await applyThemeSelection({ mode: 'manual', name: selectedCommand.themeName }, selectedCommand.themeName);
      return;
    }

    if (cmd === '/system') {
      await applyThemeSelection({ mode: 'system', name: '' }, 'System');
      return;
    }

    if (cmd === '/themes') {
      const requestedTheme = msg.replace(/^\/themes\s*/i, '').trim();
      if (!requestedTheme) {
        openThemesSubmenu();
        return;
      }

      if (requestedTheme.toLowerCase() === 'system' || requestedTheme.toLowerCase() === 'default') {
        await applyThemeSelection({ mode: 'system', name: '' }, 'System');
        return;
      }

      const match = themeCatalog.find((theme) => theme.name.toLowerCase() === requestedTheme.toLowerCase());
      if (!match) {
        setStatus(`Unknown theme: ${requestedTheme}.`);
        return;
      }

      await applyThemeSelection({ mode: 'manual', name: match.name }, match.name);
      return;
    }

    clearSlashComposer();

    const commands = {
      '/mastodon': () => {
        const next = !formRef.current.mastodonEnabled;
        setForm((prev) => ({ ...prev, mastodonEnabled: next }));
        setStatus(`Mastodon ${next ? 'enabled' : 'disabled'}.`);
      },
      '/x': () => {
        const next = !formRef.current.xEnabled;
        setForm((prev) => ({ ...prev, xEnabled: next }));
        setStatus(`X ${next ? 'enabled' : 'disabled'}.`);
      },
      '/bluesky': () => {
        const next = !formRef.current.blueskyEnabled;
        setForm((prev) => ({ ...prev, blueskyEnabled: next }));
        setStatus(`Bluesky ${next ? 'enabled' : 'disabled'}.`);
      },
      '/all': () => {
        setForm((prev) => ({ ...prev, mastodonEnabled: true, xEnabled: true, blueskyEnabled: true }));
        setStatus('All platforms enabled.');
      },
      '/none': () => {
        setForm((prev) => ({ ...prev, mastodonEnabled: false, xEnabled: false, blueskyEnabled: false }));
        setStatus('All platforms disabled.');
      },
      '/clear': () => {
        setInlineMedia([]);
        setStatus('Message cleared.');
      },
      '/post': () => submitPost(),
      '/config': () => switchScreen('config'),
    };

    if (commands[cmd]) {
      commands[cmd]();
    } else {
      setStatus(`Unknown command: ${cmd}.`);
    }
  }

  async function saveAndExit() {
    try {
      await persistForm(formRef.current, themePreference);
    } catch {}
    exit();
  }

  useInput(async (input, key) => {
    if (busy) return;
    lastInputAt.current = Date.now();
    setBlinkOn(true);

    if (screen === 'post' && isSubmitPostShortcut(key, input)) {
      await submitPost();
      return;
    }

    if (screen === 'post' && isClearImagesShortcut(key, input)) {
      setInlineMedia([]);
      setForm((prev) => ({ ...prev, attachments: '' }));
      setStatus('Cleared all image attachments.');
      return;
    }

    if (screen === 'post' && isNewPostShortcut(key, input)) {
      setForm((prev) => ({ ...prev, message: '', attachments: '' }));
      setInlineMedia([]);
      setResults([]);
      setMessageCursor(0);
      setStatus('');
      return;
    }

    if (screen === 'post' && key.ctrl && isClipboardPasteKey(input)) {
      await attachClipboardImage();
      return;
    }

    const normalizedInput = normalizeInsertedText(input);

    if (screen === 'post' && looksLikeImageToken(normalizedInput)) {
      const attached = await attachClipboardImage('auto-paste');
      const textWithoutImageTags = normalizedInput.replace(/\[image[^\]]*\]/gi, '');
      if (textWithoutImageTags.trim().length > 0) {
        setForm((prev) => {
          const currentMessage = String(prev.message || '');
          const insertIndex = editing && selection.key === 'message'
            ? clampIndex(messageCursor, currentMessage.length)
            : currentMessage.length;
          const nextMessage = insertAt(currentMessage, insertIndex, textWithoutImageTags);
          return { ...prev, message: nextMessage };
        });
        if (editing && selection.key === 'message') {
          setMessageCursor((c) => c + textWithoutImageTags.length);
        }
      }
      if (!attached) {
            setStatus('Detected image paste, but clipboard has no image.');
      }
      return;
    }

    if (key.escape) {
      if (slashActive) {
        setSlashActive(false);
      } else if (editing) {
        setEditing(false);
      } else {
        saveAndExit();
      }
      return;
    }

    if (key.ctrl && input === 'q') {
      saveAndExit();
      return;
    }

    if (key.ctrl && (input === 'c' || input === 'C')) {
      const msg = String(formRef.current.message || '');
      if (msg) {
        const ok = await writeTextToClipboard(msg);
        setStatus(ok ? 'Message copied to clipboard.' : 'Failed to copy to clipboard.');
      }
      return;
    }

    if (key.meta && input === '1') {
      setForm((prev) => ({ ...prev, mastodonEnabled: !prev.mastodonEnabled }));
      return;
    }

    if (key.meta && input === '2') {
      setForm((prev) => ({ ...prev, xEnabled: !prev.xEnabled }));
      return;
    }

    if (key.meta && input === '3') {
      setForm((prev) => ({ ...prev, blueskyEnabled: !prev.blueskyEnabled }));
      return;
    }

    if (!editing && input === 'v') {
      await attachClipboardImage();
      return;
    }

    if (!editing && key.tab) {
      switchScreen(screen === 'post' ? 'config' : 'post');
      return;
    }

    if (!editing && input === 'm') {
      switchScreen('post');
      return;
    }

    if (!editing && key.upArrow && screen === 'config') {
      setCursor((c) => (c - 1 + activeFields.length) % activeFields.length);
      return;
    }

    if (!editing && key.downArrow && screen === 'config') {
      setCursor((c) => (c + 1) % activeFields.length);
      return;
    }

    if (!editing && screen === 'post' && input === 'e') {
      setCursor(0);
      setEditing(true);
      setMessageCursor(String(formRef.current.message || '').length);
      return;
    }

    if (!editing && screen === 'post' && input === 'a') {
      setCursor(1);
      setEditing(true);
      return;
    }

    if (!editing && input === 's') {
      setBusy(true);
      setStatus('Saving config...');
      try {
        const persistedStorage = await persistForm(form, themePreference);
        if (persistedStorage) setSecretStorageMode(persistedStorage);
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
        const loaded = await loadSecretsWithMetadata();
        setSecretStorageMode(loaded.storage);
        setStatus(`Imported desktop credentials from ${imported.importedFrom}`);
        switchScreen('config');
      } catch (error) {
        setStatus(`Import failed: ${error.message}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!editing && input === 'p') {
      await submitPost();
      return;
    }

    if (!editing && input === ' ' && screen === 'config') {
      if (
        selection.key === 'mastodonEnabled' ||
        selection.key === 'xEnabled' ||
        selection.key === 'blueskyEnabled'
      ) {
        setForm((prev) => ({ ...prev, [selection.key]: !prev[selection.key] }));
      }
      return;
    }

    if (editing && screen === 'post' && slashActive && filteredCommands.length > 0 && key.upArrow) {
      setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
      return;
    }

    if (editing && screen === 'post' && slashActive && filteredCommands.length > 0 && key.downArrow) {
      setSlashIndex((i) => (i + 1) % filteredCommands.length);
      return;
    }

    if (editing && screen === 'post' && slashActive && filteredCommands.length > 0 && key.return) {
      const selected = filteredCommands[slashIndex];
      if (selected) {
        setForm((prev) => ({ ...prev, message: selected.name }));
        setMessageCursor(selected.name.length);
        setSlashActive(false);
        await executeSlashCommand(selected.name, selected);
      }
      return;
    }

    if (key.return && !editing && screen === 'config') {
      if (selection.key.endsWith('Enabled')) {
        setForm((prev) => ({ ...prev, [selection.key]: !prev[selection.key] }));
      } else {
        setEditing(true);
      }
      return;
    }

    if (editing) {
      if (screen === 'post' && selection.key === 'message' && key.ctrl && isClipboardPasteKey(input)) {
        await attachClipboardImage();
        return;
      }

      if (key.return && screen === 'post' && selection.key === 'message') {
        const currentMessage = String(formRef.current.message || '');
        const cursorIndex = clampIndex(messageCursor, currentMessage.length);
        const nextMessage = insertAt(currentMessage, cursorIndex, '\n');
        setForm((prev) => ({ ...prev, message: nextMessage }));
        setMessageCursor(cursorIndex + 1);
        return;
      }

      if (key.return) {
        setEditing(false);
        return;
      }

      if (screen === 'post' && selection.key === 'message' && key.leftArrow) {
        setMessageCursor((c) => Math.max(0, c - 1));
        return;
      }

      if (screen === 'post' && selection.key === 'message' && key.rightArrow) {
        setMessageCursor((c) => Math.min(String(formRef.current.message || '').length, c + 1));
        return;
      }

      if (screen === 'post' && selection.key === 'message' && key.upArrow) {
        const currentMessage = String(formRef.current.message || '');
        const cursorIndex = clampIndex(messageCursor, currentMessage.length);
        const layout = buildWrappedLayout(currentMessage, MESSAGE_PANEL_WIDTH);
        const caretPos = getCaretPosition(layout.lineStartIndices, cursorIndex);
        if (caretPos.line > 0) {
          const prevLineStart = layout.lineStartIndices[caretPos.line - 1];
          const prevLineEnd = caretPos.line < layout.lineStartIndices.length
            ? layout.lineStartIndices[caretPos.line] - 1
            : currentMessage.length;
          const maxCol = prevLineEnd - prevLineStart;
          const newCol = Math.min(caretPos.column, maxCol);
          setMessageCursor(prevLineStart + newCol);
        }
        return;
      }

      if (screen === 'post' && selection.key === 'message' && key.downArrow) {
        const currentMessage = String(formRef.current.message || '');
        const cursorIndex = clampIndex(messageCursor, currentMessage.length);
        const layout = buildWrappedLayout(currentMessage, MESSAGE_PANEL_WIDTH);
        const caretPos = getCaretPosition(layout.lineStartIndices, cursorIndex);
        if (caretPos.line < layout.lines.length - 1) {
          const nextLineStart = layout.lineStartIndices[caretPos.line + 1];
          const nextLineEnd = caretPos.line + 2 < layout.lineStartIndices.length
            ? layout.lineStartIndices[caretPos.line + 2] - 1
            : currentMessage.length;
          const maxCol = nextLineEnd - nextLineStart;
          const newCol = Math.min(caretPos.column, maxCol);
          setMessageCursor(nextLineStart + newCol);
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (screen === 'post' && selection.key === 'message') {
          const currentMessage = String(formRef.current.message || '');
          const cursorIndex = clampIndex(messageCursor, currentMessage.length);

          if (key.backspace) {
            if (cursorIndex === 0) return;
            const nextMessage = currentMessage.slice(0, cursorIndex - 1) + currentMessage.slice(cursorIndex);
            setForm((prev) => ({ ...prev, message: nextMessage }));
            setMessageCursor(cursorIndex - 1);
            if (slashActive && !nextMessage.startsWith('/')) {
              setSlashActive(false);
            }
            return;
          }

          if (cursorIndex >= currentMessage.length) return;
          const nextMessage = currentMessage.slice(0, cursorIndex) + currentMessage.slice(cursorIndex + 1);
          setForm((prev) => ({ ...prev, message: nextMessage }));
          if (slashActive && !nextMessage.startsWith('/')) {
            setSlashActive(false);
          }
          return;
        }

        setForm((prev) => {
          const next = String(prev[selection.key]).slice(0, -1);
          if (selection.key === 'message' && slashActive && !next.startsWith('/')) {
            setSlashActive(false);
          }
          return { ...prev, [selection.key]: next };
        });
        return;
      }
      if (normalizedInput) {
        if (screen === 'post' && selection.key === 'message') {
          const currentMessage = String(formRef.current.message || '');
          const cursorIndex = clampIndex(messageCursor, currentMessage.length);
          const combined = insertAt(currentMessage, cursorIndex, normalizedInput);
          const nextCursor = cursorIndex + normalizedInput.length;

          const canContainBracketImageToken = normalizedInput.includes('[') || normalizedInput.includes(']');
          if (canContainBracketImageToken && looksLikeImageToken(combined)) {
            const attached = await attachClipboardImage('auto-paste');
            const textWithoutImageTags = combined.replace(/\[image[^\]]*\]/gi, '').replace(/\s{2,}/g, ' ');
            setForm((prev) => ({ ...prev, message: textWithoutImageTags }));
            setMessageCursor(Math.min(nextCursor, textWithoutImageTags.length));
            if (!attached) {
              setStatus('Detected image paste, but clipboard has no image.');
            }
            return;
          }

          // Parsing inline data URIs is expensive; only do it when input can contain one.
          if (normalizedInput.includes('data:image/')) {
            const extracted = extractInlineImagesFromMessage(combined, inlineMedia.length);

            if (extracted.media.length > 0) {
              const fileAttachments = (form.attachments || '')
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean);
              const total = fileAttachments.length + inlineMedia.length + extracted.media.length;
              if (total > 4) {
                setStatus('Too many images. Max is 4 total (paths + pasted blobs).');
                return;
              }

              setInlineMedia((prev) => [...prev, ...extracted.media]);
              setStatus(`Attached ${extracted.media.length} image(s).`);
              setForm((prev) => ({ ...prev, message: extracted.cleanMessage }));
              setMessageCursor(extracted.cleanMessage.length);
              return;
            }
          }

          if (looksLikeMediaFilePath(normalizedInput)) {
            const filePath = normalizedInput.trim();
            try {
              await fs.access(filePath);
              const currentAttachments = (form.attachments || '').split(',').map(s => s.trim()).filter(Boolean);
              if (currentAttachments.length + inlineMedia.length >= 4) {
                setStatus('Too many media. Max is 4 total (paths + pasted blobs).');
                return;
              }
              setForm((prev) => {
                const existing = prev.attachments ? prev.attachments.split(',').map(s => s.trim()).filter(Boolean) : [];
                existing.push(filePath);
                return { ...prev, attachments: existing.join(', ') };
              });
              setStatus(`Attached: ${path.basename(filePath)}`);
            } catch {
              setForm((prev) => ({ ...prev, message: combined }));
              setMessageCursor(nextCursor);
            }
            return;
          }

          setForm((prev) => ({ ...prev, message: combined }));
          setMessageCursor(nextCursor);
          if (combined.startsWith('/')) {
            if (!slashActive) setSlashActive(true);
            setSlashIndex(0);
          } else if (slashActive) {
            setSlashActive(false);
          }
          return;
        }

        setForm((prev) => {
          const next = { ...prev, [selection.key]: String(prev[selection.key]) + normalizedInput };
          if (selection.key === 'message') {
            const msg = next.message.toLowerCase();
            if (next.message.startsWith('/')) {
              if (!slashActive) setSlashActive(true);
              setSlashIndex(0);
            } else if (slashActive) {
              setSlashActive(false);
            }
          }
          return next;
        });
      }
    }
  });

  if (!bootstrapped) {
    return (
      <Box flexDirection="column" padding={1} paddingLeft={2}>
        <Banner color="white" />
        <Box marginTop={1}>
          <Text dimColor>{status}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} paddingLeft={2}>
      <Banner color={uiTheme.banner} />
      <Box><Text> </Text></Box>
      {screen === 'post' && (
        <Box marginTop={1} flexDirection="column">
          <Box
            paddingX={2}
            paddingY={1}
            backgroundColor={uiTheme.panelBg}
            flexDirection="column"
          >
            <Box flexDirection="column" minHeight={5}>
              {renderedMessageLines.map((line, idx) => (
                <Text key={`msg-line-${idx}`}>{line}</Text>
              ))}
              {slashActive && filteredCommands.length > 0 && filteredCommands.map((cmd, idx) => (
                <Text
                  key={cmd.name}
                  backgroundColor={idx === slashIndex ? uiTheme.slashSelectionBg : undefined}
                  color={idx === slashIndex ? uiTheme.slashSelectionFg : undefined}
                >
                  {idx === slashIndex ? chalk.bold(' › ') : '   '}
                  {idx === slashIndex ? chalk.bold(cmd.name) : colorize(cmd.name, uiTheme.commandName)}
                  {'  '}
                  {idx === slashIndex ? cmd.desc : chalk.dim(cmd.desc)}
                </Text>
              ))}
              {imageTagLine ? (
                <Box marginTop={1}>
                  <Text>{imageTagLine}</Text>
                </Box>
              ) : null}
            </Box>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{form.message.length} chars{mediaSummary && ` · ${mediaSummary}`} · </Text>
            {busy && <Text color={uiTheme.spinner}>{busySpinner} </Text>}
            <Text dimColor>{status}</Text>
          </Box>
        </Box>
      )}

      {screen === 'post' && (
        <PostQuickHelp
          mastodonEnabled={form.mastodonEnabled}
          xEnabled={form.xEnabled}
          blueskyEnabled={form.blueskyEnabled}
          uiTheme={uiTheme}
        />
      )}

      {screen === 'config' && (
        <Box marginTop={1} flexDirection="column">
          {activeFields.map((f, idx) => {
            const active = idx === cursor;
            const val = form[f.key];
            const shown =
              f.key.toLowerCase().includes('token') ||
              f.key.toLowerCase().includes('secret') ||
              f.key.includes('Password')
                ? mask(val)
                : formatValue(val);

            return (
              <Text key={f.key} color={active ? uiTheme.configActive : undefined}>
                {active ? chalk.bold('>') : ' '} {f.label}: {shown}
                {active && editing ? chalk.dim('  [editing]') : ''}
              </Text>
            );
          })}
          <Box marginTop={1}>
            <Text dimColor>arrows move · enter edit · s save · i import · m post · ctrl+q quit</Text>
          </Box>
        </Box>
      )}

      {results.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={uiTheme.resultsHeading} bold>Results</Text>
          {results.map((r) => (
            <Text key={r.platform} color={r.success ? uiTheme.success : uiTheme.error}>
              {r.success ? '✓' : '✗'} {r.platform}: {r.success ? r.value.url : r.error}
            </Text>
          ))}
        </Box>
      )}

      {renderSecretStorageFooter(secretStorageMode) && (
        <Box marginTop={1}>
          <Text dimColor>{renderSecretStorageFooter(secretStorageMode)}</Text>
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

const Banner = React.memo(function Banner({ color }) {
  return (
    <Box justifyContent="center">
      <Text color={color}>{SOCIALSOX_BANNER}</Text>
    </Box>
  );
});

const PostQuickHelp = React.memo(function PostQuickHelp({ mastodonEnabled, xEnabled, blueskyEnabled, uiTheme }) {
  return (
    <Box marginTop={1} flexDirection="column">
      <Box>
        <Text>
          {pill('alt+1 mastodon', mastodonEnabled, uiTheme)}{' '}
          {pill('alt+2 x', xEnabled, uiTheme)}{' '}
          {pill('alt+3 bluesky', blueskyEnabled, uiTheme)}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          ctrl+n new · ctrl+p post · ctrl+c copy
        </Text>
      </Box>
      <Box justifyContent="flex-end">
        <Text dimColor>
          /commands · ctrl+q quit
        </Text>
      </Box>
    </Box>
  );
});

function pill(label, enabled, uiTheme) {
  if (!enabled) {
    if (isHexColor(uiTheme.pillDisabledHex)) {
      return chalk.hex(uiTheme.pillDisabledHex)(` ${label} `);
    }
    return colorize(` ${label} `, uiTheme.pillDisabled);
  }
  if (isHexColor(uiTheme.pillEnabledBgHex)) {
    const fgHex = isHexColor(uiTheme.pillEnabledFgHex)
      ? uiTheme.pillEnabledFgHex
      : pickContrastHex(uiTheme.pillEnabledBgHex);
    return chalk.bgHex(uiTheme.pillEnabledBgHex).hex(fgHex)(` ${label} `);
  }
  return colorizeWithBackground(` ${label} `, uiTheme.pillEnabledBg, uiTheme.pillEnabledFg, false);
}

function clampIndex(index, length) {
  if (index < 0) return 0;
  if (index > length) return length;
  return index;
}

function insertAt(text, index, value) {
  const at = clampIndex(index, text.length);
  return `${text.slice(0, at)}${value}${text.slice(at)}`;
}

function normalizeInsertedText(input) {
  const text = String(input || '');
  if (!text.includes('\r')) return text;
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function isSubmitPostShortcut(key, input) {
  const normalized = String(input || '').toLowerCase();
  if (key.ctrl && normalized === 'p') return true;
  // Some terminals encode Ctrl+P as DC1.
  if (normalized === '\u0010') return true;
  return false;
}

function isClearImagesShortcut(key, input) {
  const normalized = String(input || '').toLowerCase();
  if (key.ctrl && normalized === 'x') return true;
  // Some terminals encode Ctrl+X as CAN.
  if (normalized === '\u0018') return true;
  return false;
}

function isNewPostShortcut(key, input) {
  const normalized = String(input || '').toLowerCase();
  if (key.ctrl && normalized === 'n') return true;
  // Some terminals encode Ctrl+N as SI.
  if (normalized === '\u000e') return true;
  return false;
}

function renderMessageLines(message, caretIndex = -1, blinkOn = true, precomputedLayout = null, uiTheme = null) {
  const text = String(message || '');
  const max = MESSAGE_PANEL_WIDTH;
  const maxVisibleLines = 4;
  const layout = precomputedLayout || buildWrappedLayout(text, max);

  const clampedCaret = caretIndex >= 0 ? clampIndex(caretIndex, text.length) : -1;
  const caretPos = clampedCaret >= 0
    ? getCaretPosition(layout.lineStartIndices, clampedCaret)
    : null;

  const caretLine = caretPos ? caretPos.line : Math.max(0, layout.lines.length - 1);
  const endLineExclusive = Math.max(maxVisibleLines, caretLine + 1);
  const startLine = Math.max(0, endLineExclusive - maxVisibleLines);

  const visible = layout.lines.slice(startLine, startLine + maxVisibleLines);
  while (visible.length < maxVisibleLines) {
    visible.push('');
  }

  if (caretPos && caretPos.line >= startLine && caretPos.line < startLine + maxVisibleLines) {
    const localLineIndex = caretPos.line - startLine;
    const rawLine = visible[localLineIndex] || '';

    if (blinkOn) {
      const ch = caretPos.column < rawLine.length ? rawLine[caretPos.column] : ' ';
      const caretCell = chalk.inverse(ch);

      if (caretPos.column < rawLine.length) {
        visible[localLineIndex] =
          rawLine.slice(0, caretPos.column) +
          caretCell +
          rawLine.slice(caretPos.column + 1);
      } else {
        visible[localLineIndex] = rawLine + caretCell;
      }
    } else {
      // Character stays visible during blink-off — nothing to replace.
    }
  }

  let imageCounter = 0;
  return visible.map((lineText) => {
    const formatted = lineText === '' ? ' ' : lineText;
    if (!formatted.includes('[image')) return formatted;
    return formatted.replace(/\[image[^\]]*\]/gi, () => {
      imageCounter++;
      if (isHexColor(uiTheme?.imageTagBgHex)) {
        const fgHex = isHexColor(uiTheme?.imageTagFgHex)
          ? uiTheme.imageTagFgHex
          : pickContrastHex(uiTheme.imageTagBgHex);
        return chalk.bgHex(uiTheme.imageTagBgHex).hex(fgHex)(` Image ${imageCounter} `);
      }
      return colorizeWithBackground(
        ` Image ${imageCounter} `,
        uiTheme?.imageTagBg || 'magentaBright',
        uiTheme?.imageTagFg || 'black'
      );
    });
  });
}

function buildWrappedLayout(text, maxCols) {
  const lines = [''];
  const lineStartIndices = [0];
  let line = 0;
  let column = 0;

  const newline = (nextStartIndex) => {
    line++;
    column = 0;
    lines.push('');
    lineStartIndices.push(nextStartIndex);
  };

  const writeChar = (absoluteIndex, ch) => {
    lines[line] += ch;
    column++;

    // Soft-wrap only if more non-newline text remains.
    if (column >= maxCols) {
      const next = text[absoluteIndex + 1];
      if (typeof next === 'string' && next !== '\n') {
        newline(absoluteIndex + 1);
      }
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '\n') {
      newline(i + 1);
      i++;
      continue;
    }

    const runIsWhitespace = isInlineWhitespace(ch);
    let end = i + 1;
    while (end < text.length) {
      const next = text[end];
      if (next === '\n') break;
      if (isInlineWhitespace(next) !== runIsWhitespace) break;
      end++;
    }

    const runLength = end - i;

    if (runIsWhitespace) {
      // Preserve spaces/tabs exactly as typed.
      for (let p = i; p < end; p++) {
        if (column >= maxCols) {
          newline();
        }
        writeChar(p, text[p]);
      }
      i = end;
      continue;
    }

    // Word run: wrap at word boundary when possible; split only if word is longer than line width.
    if (column > 0 && runLength <= maxCols && column + runLength > maxCols) {
      newline(i);
    }

    for (let p = i; p < end; p++) {
      if (column >= maxCols) {
        newline();
      }
      writeChar(p, text[p]);
    }

    i = end;
  }

  return { lines, lineStartIndices };
}

function getCaretPosition(lineStartIndices, caretIndex) {
  const line = findLineIndexForCaret(lineStartIndices, caretIndex);
  const column = caretIndex - lineStartIndices[line];
  return { line, column };
}

function findLineIndexForCaret(lineStartIndices, caretIndex) {
  // Upper-bound binary search for first start index > caretIndex.
  let lo = 0;
  let hi = lineStartIndices.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStartIndices[mid] <= caretIndex) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return Math.max(0, lo - 1);
}

function isInlineWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\r';
}

function looksLikeImageToken(input) {
  return /\[image[^\]]*\]/i.test(input);
}

function isClipboardPasteKey(input) {
  return String(input).toLowerCase() === 'v';
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS]);

function isVideoPath(p) {
  return VIDEO_EXTS.has(path.extname(p).toLowerCase());
}

function looksLikeMediaFilePath(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return false;
  const ext = path.extname(trimmed).toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return false;
  return trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../') || trimmed.startsWith('~') || trimmed.includes('/');
}

function renderImageTagLine(attachmentsCsv, inlineMedia, uiTheme = null) {
  const pathTags = (attachmentsCsv || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (pathTags.length === 0 && inlineMedia.length === 0) return '';

  const tags = [];
  let idx = 1;
  for (const p of pathTags) {
    const label = isVideoPath(p) ? 'Video' : 'Image';
    if (isHexColor(uiTheme?.imageTagBgHex)) {
      const fgHex = isHexColor(uiTheme?.imageTagFgHex)
        ? uiTheme.imageTagFgHex
        : pickContrastHex(uiTheme.imageTagBgHex);
      tags.push(chalk.bgHex(uiTheme.imageTagBgHex).hex(fgHex)(` ${label} ${idx++} `));
    } else {
      tags.push(colorizeWithBackground(
        ` ${label} ${idx++} `,
        uiTheme?.imageTagBg || 'magentaBright',
        uiTheme?.imageTagFg || 'black'
      ));
    }
  }
  for (const item of inlineMedia) {
    const label = item.isVideo ? 'Video' : 'Image';
    if (isHexColor(uiTheme?.imageTagBgHex)) {
      const fgHex = isHexColor(uiTheme?.imageTagFgHex)
        ? uiTheme.imageTagFgHex
        : pickContrastHex(uiTheme.imageTagBgHex);
      tags.push(chalk.bgHex(uiTheme.imageTagBgHex).hex(fgHex)(` ${label} ${idx++} `));
    } else {
      tags.push(colorizeWithBackground(
        ` ${label} ${idx++} `,
        uiTheme?.imageTagBg || 'magentaBright',
        uiTheme?.imageTagFg || 'black'
      ));
    }
  }
  return tags.join(' ');
}

function renderMediaCount(attachmentsCsv, inlineMedia) {
  const pathTags = (attachmentsCsv || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let images = 0;
  let videos = 0;
  for (const p of pathTags) {
    if (isVideoPath(p)) videos++;
    else images++;
  }
  for (const item of inlineMedia) {
    if (item.isVideo) videos++;
    else images++;
  }

  const parts = [];
  if (images > 0) parts.push(`${images} image${images !== 1 ? 's' : ''}`);
  if (videos > 0) parts.push(`${videos} video${videos !== 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(', ') : '';
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildBanner() {
  try {
    return figlet.textSync('socialsox', { font: 'Pagga' });
  } catch {
    return 'SOCIALSOX';
  }
}

function mask(value) {
  if (!value) return '<empty>';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, value.length - 6))}${value.slice(-3)}`;
}

async function persistForm(form, themePreference) {
  const [, secretStorage] = await Promise.all([
    saveConfig({
      mastodon: { enabled: form.mastodonEnabled, instance: form.mastodonInstance },
      x: { enabled: form.xEnabled },
      bluesky: { enabled: form.blueskyEnabled, handle: form.blueskyHandle },
      compose: { lastAttachments: form.attachments },
      theme: normalizeThemePreference(themePreference),
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
  return secretStorage;
}

function renderSecretStorageFooter(mode) {
  if (mode === 'fallback') return 'secrets storage: encrypted fallback file (~/.config/socialsox-tui/secrets.json)';
  return '';
}

function getFilteredSlashCommands(slashQuery, themeCatalog) {
  if (!slashQuery) return [];

  if (slashQuery === '/themes') {
    return [{
      name: '/themes',
      desc: 'Open theme picker submenu',
      kind: 'theme-menu',
    }];
  }

  if (slashQuery.startsWith('/themes ')) {
    const themeCommands = [
      {
        name: '/themes system',
        desc: 'Default: terminal-derived system theme',
        kind: 'system',
      },
      ...themeCatalog.map((theme) => ({
        name: `/themes ${theme.name}`,
        desc: `Apply ${theme.name}`,
        kind: 'manual',
        themeName: theme.name,
      })),
    ];

    return themeCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(slashQuery));
  }

  return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(slashQuery));
}

function normalizeThemePreference(themePreference, themeCatalog = []) {
  const mode = themePreference?.mode === 'manual' ? 'manual' : 'system';
  const name = typeof themePreference?.name === 'string' ? themePreference.name.trim() : '';

  if (mode !== 'manual' || !name) {
    return { mode: 'system', name: '' };
  }

  const matched = themeCatalog.find((theme) => theme.name.toLowerCase() === name.toLowerCase());
  if (!matched) {
    return { mode: 'system', name: '' };
  }

  return { mode: 'manual', name: matched.name };
}

function resolveUiTheme(themePreference, themeCatalog) {
  const normalized = normalizeThemePreference(themePreference, themeCatalog);
  if (normalized.mode !== 'manual') {
    return buildSystemTheme();
  }

  const matched = themeCatalog.find((theme) => theme.name === normalized.name);
  if (!matched) {
    return buildSystemTheme();
  }

  return buildThemeFromPalette(matched.palette);
}

function buildSystemTheme() {
  const slashSelectionBg = 'black';
  const pillEnabledBg = 'cyan';
  const imageTagBg = 'magentaBright';
  return {
    banner: 'cyanBright',
    panelBg: pickPanelBackgroundColor(),
    panelBgHex: '',
    spinner: 'cyan',
    commandName: 'cyan',
    slashSelectionBg,
    slashSelectionFg: pickContrastTextColor(slashSelectionBg),
    pillEnabledBg,
    pillEnabledFg: pickContrastTextColor(pillEnabledBg),
    pillEnabledBgHex: '',
    pillEnabledFgHex: '',
    pillDisabled: 'gray',
    pillDisabledHex: '',
    caret: 'white',
    imageTagBg,
    imageTagFg: pickContrastTextColor(imageTagBg),
    imageTagBgHex: '',
    imageTagFgHex: '',
    configActive: 'green',
    resultsHeading: 'yellow',
    success: 'green',
    error: 'red',
  };
}

function buildThemeFromPalette(palette) {
  const slashSelectionBg = hexToInkColor(palette.selection_background || palette.color8, 'black');
  const accent = hexToInkColor(palette.accent || palette.color4, 'cyanBright');
  const panelBgHex = normalizeHexColor(palette.background || palette.color0);
  const pillEnabledBgHex = normalizeHexColor(palette.color4 || palette.accent);
  const pillDisabledHex = normalizeHexColor(palette.color8 || palette.color0);
  const pillEnabledBg = hexToInkColor(palette.color4 || palette.accent, accent);
  const imageTagBgHex = normalizeHexColor(palette.color5 || palette.accent);
  const imageTagBg = hexToInkColor(palette.color5 || palette.accent, 'magentaBright');
  return {
    banner: accent,
    panelBg: panelBgHex || hexToInkColor(palette.background || palette.color0, 'gray'),
    panelBgHex,
    spinner: accent,
    commandName: accent,
    slashSelectionBg,
    slashSelectionFg: pickContrastTextColor(slashSelectionBg),
    pillEnabledBg,
    pillEnabledFg: pickContrastTextColor(pillEnabledBg),
    pillEnabledBgHex,
    pillEnabledFgHex: pillEnabledBgHex ? pickContrastHex(pillEnabledBgHex) : '',
    pillDisabled: hexToInkColor(palette.color8 || palette.color0, 'gray'),
    pillDisabledHex,
    caret: hexToInkColor(palette.cursor || palette.foreground || palette.color15, 'whiteBright'),
    imageTagBg,
    imageTagFg: pickContrastTextColor(imageTagBg),
    imageTagBgHex,
    imageTagFgHex: imageTagBgHex ? pickContrastHex(imageTagBgHex) : '',
    configActive: hexToInkColor(palette.color2 || palette.accent, 'green'),
    resultsHeading: hexToInkColor(palette.color3 || palette.accent, 'yellow'),
    success: hexToInkColor(palette.color2 || palette.accent, 'green'),
    error: hexToInkColor(palette.color1, 'red'),
  };
}

function colorize(value, colorName) {
  const method = String(colorName || '');
  const fn = chalk[method];
  if (typeof fn === 'function') {
    return fn(value);
  }
  return value;
}

function colorizeWithBackground(value, bgColorName, fgColorName, bold = true) {
  let painter = chalk;

  const bgMethod = toBackgroundMethodName(bgColorName);
  if (bgMethod && typeof painter[bgMethod] === 'function') {
    painter = painter[bgMethod];
  }

  const fgMethod = String(fgColorName || '');
  if (fgMethod && typeof painter[fgMethod] === 'function') {
    painter = painter[fgMethod];
  }

  if (bold && typeof painter.bold === 'function') {
    painter = painter.bold;
  }

  return painter(value);
}

function toBackgroundMethodName(colorName) {
  const name = String(colorName || '');
  if (!name) return '';
  return `bg${name[0].toUpperCase()}${name.slice(1)}`;
}

function pickContrastTextColor(bgColor) {
  return isLightInkColor(bgColor) ? 'black' : 'whiteBright';
}

function isLightInkColor(colorName) {
  const lightColors = new Set([
    'yellow',
    'yellowBright',
    'white',
    'whiteBright',
    'cyanBright',
  ]);
  return lightColors.has(String(colorName || ''));
}

function hexToInkColor(hex, fallback = 'white') {
  if (!isHexColor(hex)) return fallback;
  const [r, g, b] = parseHexColor(hex);

  let bestName = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const swatch of ANSI_SWATCHES) {
    const dr = r - swatch.r;
    const dg = g - swatch.g;
    const db = b - swatch.b;
    const distance = (dr * dr) + (dg * dg) + (db * db);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestName = swatch.name;
    }
  }

  return bestName;
}

function isHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || ''));
}

function normalizeHexColor(value) {
  const text = String(value || '').trim();
  if (!isHexColor(text)) return '';
  return text.toLowerCase();
}

function pickContrastHex(hex) {
  if (!isHexColor(hex)) return '#ffffff';
  const [r, g, b] = parseHexColor(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.58 ? '#000000' : '#ffffff';
}

function parseHexColor(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

const ANSI_SWATCHES = [
  { name: 'black', r: 0, g: 0, b: 0 },
  { name: 'red', r: 205, g: 49, b: 49 },
  { name: 'green', r: 13, g: 188, b: 121 },
  { name: 'yellow', r: 229, g: 229, b: 16 },
  { name: 'blue', r: 36, g: 114, b: 200 },
  { name: 'magenta', r: 188, g: 63, b: 188 },
  { name: 'cyan', r: 17, g: 168, b: 205 },
  { name: 'white', r: 229, g: 229, b: 229 },
  { name: 'gray', r: 102, g: 102, b: 102 },
  { name: 'redBright', r: 241, g: 76, b: 76 },
  { name: 'greenBright', r: 35, g: 209, b: 139 },
  { name: 'yellowBright', r: 245, g: 245, b: 67 },
  { name: 'blueBright', r: 59, g: 142, b: 234 },
  { name: 'magentaBright', r: 214, g: 112, b: 214 },
  { name: 'cyanBright', r: 41, g: 184, b: 219 },
  { name: 'whiteBright', r: 255, g: 255, b: 255 },
];

function pickPanelBackgroundColor() {
  const indices = readTerminalColorIndices();
  if (!indices) {
    // No bg hint from terminal; use a neutral ANSI color.
    return 'gray';
  }

  const isLightBg = inferLightBackground(indices.bg, indices.fg);
  const shifted = isLightBg
    ? shiftAnsiBrightness(indices.bg, -1)
    : shiftAnsiBrightness(indices.bg, 1);

  return ansiIndexToInkColor(shifted);
}

function readTerminalColorIndices() {
  const raw = process.env.COLORFGBG;
  if (!raw) return null;

  const parts = raw
    .split(';')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value));

  if (parts.length === 0) return null;

  return {
    fg: parts.length > 1 ? parts[0] : null,
    bg: parts[parts.length - 1],
  };
}

function inferLightBackground(bgIndex, fgIndex) {
  const bg = normalizeAnsi16Index(bgIndex);
  const bgBase = bg % 8;
  const bgBright = bg >= 8;

  if (Number.isInteger(fgIndex)) {
    const fg = normalizeAnsi16Index(fgIndex);
    const fgBase = fg % 8;

    // Typical defaults: dark fg on light bg, light fg on dark bg.
    if (fgBase === 0 && bgBase !== 0) return true;
    if (fgBase === 7 && bgBase !== 7) return false;
  }

  if (bgBase === 7) return true;
  if (bgBright && bgBase !== 0) return true;
  return false;
}

function shiftAnsiBrightness(index, direction) {
  const normalized = normalizeAnsi16Index(index);

  if (direction > 0) {
    if (normalized < 8) return normalized + 8;
    return normalized;
  }

  if (normalized >= 8) return normalized - 8;

  // White has no dimmer same-hue variant in ANSI basics; use bright black as subtle dark contrast.
  if (normalized % 8 === 7) return 8;
  return normalized;
}

function ansiIndexToInkColor(index) {
  const baseNames = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const normalized = normalizeAnsi16Index(index);
  const base = normalized % 8;
  const bright = normalized >= 8;
  const baseName = baseNames[base];
  return bright ? `${baseName}Bright` : baseName;
}

function normalizeAnsi16Index(value) {
  if (!Number.isInteger(value)) return 0;
  if (value < 0) return 0;
  return value % 16;
}
