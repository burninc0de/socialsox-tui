import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v']);

const MIME_EXT_MAP = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function guessMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

export async function loadMedia(pathsCsv, inlineMedia = []) {
  if ((!pathsCsv || !pathsCsv.trim()) && (!inlineMedia || inlineMedia.length === 0)) return [];

  const split = pathsCsv
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (split.length + inlineMedia.length > 4) {
    throw new Error('Max 4 media files are allowed.');
  }

  const out = [];
  for (const filePath of split) {
    const ext = path.extname(filePath).toLowerCase();
    const isImage = IMAGE_EXTS.has(ext);
    const isVideo = VIDEO_EXTS.has(ext);
    if (!isImage && !isVideo) {
      throw new Error(`Unsupported media type: ${filePath}`);
    }

    const [stat, buffer] = await Promise.all([fs.stat(filePath), fs.readFile(filePath)]);
    out.push({
      path: filePath,
      name: path.basename(filePath),
      isImage,
      isVideo,
      size: stat.size,
      mimeType: guessMime(filePath),
      buffer,
    });
  }

  return [...out, ...inlineMedia];
}

function sanitizeBase64(input) {
  return input.replace(/\s+/g, '');
}

function extensionForMime(mime) {
  return MIME_EXT_MAP[mime] || 'png';
}

export function extractInlineImagesFromMessage(input, currentInlineCount = 0) {
  if (!input || !input.includes('data:image/')) {
    return { cleanMessage: input, media: [] };
  }

  const regex = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)/g;
  const found = [];
  let cleanMessage = input;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const mimeType = String(match[1]).toLowerCase();
    const base64Payload = sanitizeBase64(match[2]);
    if (!MIME_EXT_MAP[mimeType]) {
      continue;
    }

    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer.length) continue;

    const index = currentInlineCount + found.length + 1;
    const ext = extensionForMime(mimeType);
    found.push({
      path: `[pasted-inline-${index}.${ext}]`,
      name: `pasted-inline-${index}.${ext}`,
      isImage: true,
      isVideo: false,
      size: buffer.length,
      mimeType,
      buffer,
    });

    cleanMessage = cleanMessage.replace(match[0], '').replace(/\n{3,}/g, '\n\n').trim();
  }

  return { cleanMessage, media: found };
}

export async function compressImageForX(media, maxBytes = 5 * 1024 * 1024) {
  if (!media.isImage || media.size <= maxBytes) return media;

  let quality = 82;
  let output = await sharp(media.buffer).rotate().resize({ width: 2400, withoutEnlargement: true }).jpeg({ quality }).toBuffer();

  while (output.length > maxBytes && quality > 40) {
    quality -= 8;
    output = await sharp(media.buffer).rotate().resize({ width: 2200, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  }

  if (output.length > maxBytes) {
    throw new Error(`Could not compress ${media.name} below 5MB for X.`);
  }

  return {
    ...media,
    mimeType: 'image/jpeg',
    size: output.length,
    buffer: output,
  };
}
