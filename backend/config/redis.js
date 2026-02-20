const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = createClient({ url: REDIS_URL });

redis.on('error', (err) => {
  console.error('[Redis] Client error', err);
});

async function initRedis() {
  if (redis.isOpen) return;
  await redis.connect();
  console.log('[Redis] Connected');
}

module.exports = { redis, initRedis };
