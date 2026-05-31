import { execa } from 'execa';

const CLIPBOARD_MAX_BYTES = 20 * 1024 * 1024;

function extForMime(mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'png';
}

async function runBinary(cmd, args) {
  const result = await execa(cmd, args, {
    reject: false,
    encoding: 'buffer',
    maxBuffer: CLIPBOARD_MAX_BYTES,
  });
  if (result.exitCode !== 0) return null;
  if (!result.stdout || result.stdout.length === 0) return null;
  return result.stdout;
}

async function runText(cmd, args) {
  const result = await execa(cmd, args, { reject: false });
  if (result.exitCode !== 0) return null;
  return result.stdout || '';
}

async function readFromWlPaste() {
  const typesOut = await runText('wl-paste', ['--list-types']);
  if (!typesOut) return null;

  const types = typesOut
    .split('\n')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const mimeType = types.find((t) => t.startsWith('image/'));
  if (!mimeType) return null;

  const buffer = await runBinary('wl-paste', ['--no-newline', '--type', mimeType]);
  if (!buffer) return null;

  return { mimeType, buffer };
}

async function readFromXclip() {
  const candidates = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  for (const mimeType of candidates) {
    const buffer = await runBinary('xclip', ['-selection', 'clipboard', '-t', mimeType, '-o']);
    if (buffer) return { mimeType, buffer };
  }
  return null;
}

export async function readClipboardImageMedia(index = 1) {
  let result = await readFromWlPaste();
  if (!result) {
    result = await readFromXclip();
  }
  if (!result) return null;

  const ext = extForMime(result.mimeType);
  const name = `clipboard-${index}.${ext}`;

  return {
    path: `[${name}]`,
    name,
    isImage: true,
    isVideo: false,
    size: result.buffer.length,
    mimeType: result.mimeType,
    buffer: result.buffer,
  };
}
