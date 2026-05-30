import PQueue from 'p-queue';
import { postToMastodon, postToX, postToBluesky } from './platforms.js';

export async function runCrosspost({ message, media, config, secrets }) {
  if (!message || !message.trim()) {
    throw new Error('Message cannot be empty.');
  }

  const jobs = [];

  if (config.mastodon.enabled) {
    jobs.push({
      platform: 'mastodon',
      run: () => postToMastodon(message, config, secrets, media),
    });
  }

  if (config.x.enabled) {
    jobs.push({
      platform: 'x',
      run: () => postToX(message, config, secrets, media),
    });
  }

  if (config.bluesky.enabled) {
    jobs.push({
      platform: 'bluesky',
      run: () => postToBluesky(message, config, secrets, media),
    });
  }

  if (!jobs.length) {
    throw new Error('Enable at least one platform.');
  }

  const queue = new PQueue({ concurrency: 3 });
  const results = await Promise.all(
    jobs.map((job) =>
      queue.add(async () => {
        try {
          const value = await job.run();
          return { platform: job.platform, success: true, value };
        } catch (error) {
          return { platform: job.platform, success: false, error: error.message };
        }
      })
    )
  );

  return results;
}
