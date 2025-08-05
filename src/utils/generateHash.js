import { createHash } from 'node:crypto';

export function generateHash (arr) {
  const s = String(arr.join(','));
  return createHash('sha256').update(s).digest('hex');
}
