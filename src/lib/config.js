import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import keytar from 'keytar';

const APP_NAME = 'socialsox-tui';
const CONFIG_DIR = path.join(os.homedir(), '.config', APP_NAME);
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const FALLBACK_SECRET_PATH = path.join(CONFIG_DIR, 'secrets.json');
const LEGACY_IMPORT_PATH = path.join(CONFIG_DIR, 'socialsox-credentials.json');
const SECRET_KEYS = [
  'mastodonToken',
  'xApiKey',
  'xApiSecret',
  'xAccessToken',
  'xAccessTokenSecret',
  'blueskyPassword',
];

const DEFAULT_CONFIG = {
  mastodon: { enabled: true, instance: '' },
  x: { enabled: true },
  bluesky: { enabled: true, handle: '' },
  compose: { lastAttachments: '' },
  theme: { mode: 'system', name: '' },
};

async function ensureDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

function getMachineDerivedKey() {
  const id = `${os.hostname()}|${os.userInfo().username}|${os.platform()}|${APP_NAME}`;
  return crypto.createHash('sha256').update(id).digest();
}

function encryptUtf8(data) {
  const iv = crypto.randomBytes(16);
  const key = getMachineDerivedKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptUtf8(data) {
  const raw = Buffer.from(data, 'base64');
  const iv = raw.subarray(0, 16);
  const tag = raw.subarray(16, 32);
  const encrypted = raw.subarray(32);
  const key = getMachineDerivedKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}

function toEncryptedEnvelope(value) {
  return {
    __encrypted: true,
    v: 1,
    data: encryptUtf8(JSON.stringify(value)),
  };
}

function fromMaybeEncryptedEnvelope(parsed) {
  if (parsed && parsed.__encrypted === true && typeof parsed.data === 'string') {
    return JSON.parse(decryptUtf8(parsed.data));
  }
  return parsed;
}

export async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const value = fromMaybeEncryptedEnvelope(parsed);
    return { ...DEFAULT_CONFIG, ...(value || {}) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config) {
  await ensureDir();
  const encrypted = toEncryptedEnvelope(config);
  await fs.writeFile(CONFIG_PATH, JSON.stringify(encrypted, null, 2), 'utf8');
}

async function readFallbackSecrets() {
  try {
    const raw = await fs.readFile(FALLBACK_SECRET_PATH, 'utf8');
    return fromMaybeEncryptedEnvelope(JSON.parse(raw)) || {};
  } catch {
    return {};
  }
}

async function writeFallbackSecrets(secrets) {
  await ensureDir();
  const encrypted = toEncryptedEnvelope(secrets);
  await fs.writeFile(FALLBACK_SECRET_PATH, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
}

function emptySecrets() {
  return {
    mastodonToken: '',
    xApiKey: '',
    xApiSecret: '',
    xAccessToken: '',
    xAccessTokenSecret: '',
    blueskyPassword: '',
  };
}

function hasAnySecrets(secrets) {
  return SECRET_KEYS.some((k) => Boolean(secrets[k]));
}

export async function loadSecretsWithMetadata() {
  const out = emptySecrets();
  let keychainFailed = false;

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

    if (hasAnySecrets(out)) {
      return { secrets: out, storage: 'keychain' };
    }
  } catch {
    keychainFailed = true;
  }

  const fallback = await readFallbackSecrets();
  const merged = { ...out, ...fallback };
  if (hasAnySecrets(merged)) {
    return { secrets: merged, storage: 'fallback' };
  }

  return { secrets: merged, storage: keychainFailed ? 'fallback' : 'keychain' };
}

export async function loadSecrets() {
  const loaded = await loadSecretsWithMetadata();
  return loaded.secrets;
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
    return 'keychain';
  } catch {
    await writeFallbackSecrets(secrets);
    return 'fallback';
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
      theme: {
        mode: 'system',
        name: '',
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
  const candidatePaths = customPath ? [customPath] : [LEGACY_IMPORT_PATH];

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

export async function hasLegacyImportFile() {
  return fileExists(LEGACY_IMPORT_PATH);
}

export function getLegacyImportPath() {
  return LEGACY_IMPORT_PATH;
}
