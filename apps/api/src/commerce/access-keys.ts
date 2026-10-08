import crypto from 'node:crypto';

export const ACCESS_KEY_PATTERN = /^ak1_[A-Za-z0-9_-]{40,60}$/;

export function generateAccessKey() {
  return `ak1_${crypto.randomBytes(32).toString('base64url')}`;
}

export function hashAccessKey(accessKey: string) {
  return crypto.createHash('sha256').update(accessKey).digest('hex');
}
