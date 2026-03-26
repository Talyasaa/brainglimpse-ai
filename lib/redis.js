// Upstash Redis client — shared across all serverless functions.
// Returns null if env vars are not configured (graceful degradation).

import { Redis } from '@upstash/redis';

let _redis = null;

export function getRedis() {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  _redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}
