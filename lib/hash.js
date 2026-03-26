import { createHash } from 'crypto';

// Returns a short, stable cache key for any string.
export const hashKey = (str) =>
  createHash('sha256')
    .update(str.toLowerCase().trim())
    .digest('hex')
    .slice(0, 24);
