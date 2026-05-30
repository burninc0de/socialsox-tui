import { TwitterApi } from 'twitter-api-v2';
import { compressImageForX } from './media.js';

function normalizeMastodonInstance(instance) {
  let clean = (instance || '').trim();
  if (!clean.startsWith('http')) clean = `https://${clean}`;
  if (clean.endsWith('/')) clean = clean.slice(0, -1);
  const url = new URL(clean);
  return `${url.protocol}//${url.host}`;
}

async function waitForMastodonMedia(instance, token, mediaId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${instance}/api/v1/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (data.url || data.preview_url || data.meta?.original) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
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
      await waitForMastodonMedia(instance, token, uploadData.id);
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
  for (const rawItem of media) {
    const item = rawItem.isImage ? await compressImageForX(rawItem) : rawItem;
    const mediaId = await client.v1.uploadMedia(item.buffer, { mimeType: item.mimeType });
    mediaIds.push(mediaId);
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
