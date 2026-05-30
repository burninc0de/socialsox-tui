import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import keytar from 'keytar';

const APP_NAME = 'socialsox-tui';
const CONFIG_DIR = path.join(os.homedir(), '.config', APP_NAME);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const FALLBACK_SECRET_PATH = path.join(CONFIG_DIR, 'secrets.json');

const DEFAULT_CONFIG = {
  mastodon: { enabled: true, instance: '' },
  x: { enabled: true },
  bluesky: { enabled: true, handle: '' },
  compose: { lastAttachments: '' },
};

async function ensureDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config) {
  await ensureDir();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

async function readFallbackSecrets() {
  try {
    const raw = await fs.readFile(FALLBACK_SECRET_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeFallbackSecrets(secrets) {
  await ensureDir();
  await fs.writeFile(FALLBACK_SECRET_PATH, JSON.stringify(secrets, null, 2), { mode: 0o600 });
}

export async function loadSecrets() {
  const out = {
    mastodonToken: '',
    xApiKey: '',
    xApiSecret: '',
    xAccessToken: '',
    xAccessTokenSecret: '',
    blueskyPassword: '',
  };

  try {
    const entries = await Promise.all([
      keytar.getPassword(APP_NAME, 'mastodonToken'),
      keytar.getPassword(APP_NAME, 'xApiKey'),
      keytar.getPassword(APP_NAME, 'xApiSecret'),
      keytar.getPassword(APP_NAME, 'xAccessToken'),
      keytar.getPassword(APP_NAME, 'xAccessTokenSecret'),
      keytar.getPassword(APP_NAME, 'blueskyPassword'),
    ]);
    [
      out.mastodonToken,
      out.xApiKey,
      out.xApiSecret,
      out.xAccessToken,
      out.xAccessTokenSecret,
      out.blueskyPassword,
    ] = entries.map((v) => v || '');

    const hasAny = Object.values(out).some(Boolean);
    if (hasAny) return out;
  } catch {
    // Fall through to file fallback.
  }

  const fallback = await readFallbackSecrets();
  return { ...out, ...fallback };
}

export async function saveSecrets(secrets) {
  try {
    await Promise.all([
      keytar.setPassword(APP_NAME, 'mastodonToken', secrets.mastodonToken || ''),
      keytar.setPassword(APP_NAME, 'xApiKey', secrets.xApiKey || ''),
      keytar.setPassword(APP_NAME, 'xApiSecret', secrets.xApiSecret || ''),
      keytar.setPassword(APP_NAME, 'xAccessToken', secrets.xAccessToken || ''),
      keytar.setPassword(APP_NAME, 'xAccessTokenSecret', secrets.xAccessTokenSecret || ''),
      keytar.setPassword(APP_NAME, 'blueskyPassword', secrets.blueskyPassword || ''),
    ]);
  } catch {
    await writeFallbackSecrets(secrets);
  }
}

export async function resetStoredData() {
  await Promise.allSettled([
    fs.rm(CONFIG_PATH, { force: true }),
    fs.rm(FALLBACK_SECRET_PATH, { force: true }),
    keytar.deletePassword(APP_NAME, 'mastodonToken'),
    keytar.deletePassword(APP_NAME, 'xApiKey'),
    keytar.deletePassword(APP_NAME, 'xApiSecret'),
    keytar.deletePassword(APP_NAME, 'xAccessToken'),
    keytar.deletePassword(APP_NAME, 'xAccessTokenSecret'),
    keytar.deletePassword(APP_NAME, 'blueskyPassword'),
  ]);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeLegacyData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Credentials file does not contain a JSON object.');
  }

  return {
    config: {
      mastodon: {
        enabled: true,
        instance: String(data.mastodonInstance || '').trim(),
      },
      x: {
        enabled: true,
      },
      bluesky: {
        enabled: true,
        handle: String(data.blueskyHandle || '').trim(),
      },
      compose: {
        lastAttachments: '',
      },
    },
    secrets: {
      mastodonToken: String(data.mastodonToken || '').trim(),
      xApiKey: String(data.twitterKey || '').trim(),
      xApiSecret: String(data.twitterSecret || '').trim(),
      xAccessToken: String(data.twitterToken || '').trim(),
      xAccessTokenSecret: String(data.twitterTokenSecret || '').trim(),
      blueskyPassword: String(data.blueskyPassword || '').trim(),
    },
  };
}

export async function importLegacySocialSoxCredentials(customPath = '') {
  const fixedPath = path.join(CONFIG_DIR, 'socialsox-credentials.json');
  const candidatePaths = customPath ? [customPath] : [fixedPath];

  for (const candidate of candidatePaths) {
    if (!(await fileExists(candidate))) continue;

    const raw = await fs.readFile(candidate, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeLegacyData(parsed);

    await Promise.all([saveConfig(normalized.config), saveSecrets(normalized.secrets)]);
    return {
      importedFrom: candidate,
      ...normalized,
    };
  }

  throw new Error(
    `No SocialSox credentials export found. Checked: ${candidatePaths.join(', ')}`
  );
}
