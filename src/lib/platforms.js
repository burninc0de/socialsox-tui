import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TwitterApi } from 'twitter-api-v2';
import { compressImageForX } from './media.js';

function extensionForMime(mimeType, fallbackName = 'media.bin') {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'video/webm') return '.webm';
  return path.extname(fallbackName) || '.bin';
}

function normalizeMastodonInstance(instance) {
  let clean = (instance || '').trim();
  if (!clean.startsWith('http')) clean = `https://${clean}`;
  if (clean.endsWith('/')) clean = clean.slice(0, -1);
  const url = new URL(clean);
  return `${url.protocol}//${url.host}`;
}

async function waitForMastodonMedia() {
  await new Promise((resolve) => setTimeout(resolve, 20000));
}

export async function postToMastodon(message, config, secrets, media) {
  const instance = normalizeMastodonInstance(config.mastodon.instance);
  const token = secrets.mastodonToken;

  if (!token) throw new Error('Missing Mastodon token.');

  const mediaIds = [];
  for (const item of media) {
    const form = new FormData();
    const blob = new Blob([item.buffer], { type: item.mimeType });
    form.append('file', blob, item.name);

    const uploadRes = await fetch(`${instance}/api/v2/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!uploadRes.ok) {
      throw new Error(`Mastodon media upload failed (${uploadRes.status}).`);
    }

    const uploadData = await uploadRes.json();
    mediaIds.push(uploadData.id);

    if (item.isVideo) {
      await waitForMastodonMedia();
    }
  }

  const res = await fetch(`${instance}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: message,
      media_ids: mediaIds.length ? mediaIds : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mastodon post failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { platform: 'mastodon', success: true, url: data.url };
}

export async function postToX(message, _config, secrets, media) {
  const needed = ['xApiKey', 'xApiSecret', 'xAccessToken', 'xAccessTokenSecret'];
  for (const k of needed) {
    if (!secrets[k]) throw new Error(`Missing X credential: ${k}`);
  }

  if (message.length > 280) {
    throw new Error(`X post is ${message.length} chars; max is 280.`);
  }

  const client = new TwitterApi({
    appKey: secrets.xApiKey,
    appSecret: secrets.xApiSecret,
    accessToken: secrets.xAccessToken,
    accessSecret: secrets.xAccessTokenSecret,
  });

  const mediaIds = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'socialsox-x-'));
  try {
    for (let i = 0; i < media.length; i += 1) {
      const rawItem = media[i];
      const item = rawItem.isImage ? await compressImageForX(rawItem) : rawItem;

      const ext = extensionForMime(item.mimeType, item.name);
      const tempPath = path.join(tempDir, `upload-${i + 1}${ext}`);
      await fs.writeFile(tempPath, item.buffer);

      const mediaId = await client.v1.uploadMedia(tempPath, { mimeType: item.mimeType });
      mediaIds.push(mediaId);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  const tweet = await client.v2.tweet({
    text: message,
    media: mediaIds.length ? { media_ids: mediaIds } : undefined,
  });

  const tweetId = tweet.data.id;
  return {
    platform: 'x',
    success: true,
    url: `https://twitter.com/i/status/${tweetId}`,
  };
}

export async function postToBluesky(message, config, secrets, media) {
  const handle = config.bluesky.handle;
  const password = secrets.blueskyPassword;
  if (!handle || !password) {
    throw new Error('Missing Bluesky handle/password.');
  }

  const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });

  if (!sessionRes.ok) {
    throw new Error(`Bluesky auth failed (${sessionRes.status}).`);
  }

  const session = await sessionRes.json();

  const images = [];
  let videoBlob = null;

  for (const item of media) {
    const up = await fetch('https://bsky.social/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessJwt}`,
        'Content-Type': item.mimeType,
      },
      body: item.buffer,
    });

    if (!up.ok) {
      throw new Error(`Bluesky upload failed for ${item.name} (${up.status}).`);
    }

    const upData = await up.json();
    if (item.isVideo && !videoBlob) {
      videoBlob = upData.blob;
    } else if (item.isImage) {
      images.push(upData.blob);
    }
  }

  const embed = videoBlob
    ? { $type: 'app.bsky.embed.video', video: videoBlob }
    : images.length
      ? {
          $type: 'app.bsky.embed.images',
          images: images.slice(0, 4).map((image, index) => ({
            image,
            alt: `attachment-${index + 1}`,
          })),
        }
      : undefined;

  const createRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text: message,
        createdAt: new Date().toISOString(),
        embed,
      },
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Bluesky post failed (${createRes.status}): ${body}`);
  }

  const data = await createRes.json();
  const postId = String(data.uri).split('/').pop();

  return {
    platform: 'bluesky',
    success: true,
    url: `https://bsky.app/profile/${session.did}/post/${postId}`,
  };
}
