import crypto from 'node:crypto';

function secret() {
  const value = process.env.EMAIL_VERIFICATION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('EMAIL_VERIFICATION_SECRET must contain at least 32 characters');
  }
  return value;
}

export function generateEmailCode() {
  return String(crypto.randomInt(100000, 1000000));
}

export function hashEmailCode(email: string, code: string) {
  return crypto
    .createHmac('sha256', secret())
    .update(`${email.toLowerCase()}:${code}`)
    .digest('hex');
}

export function emailCodeMatches(email: string, code: string, expectedHash: string) {
  const a = Buffer.from(hashEmailCode(email, code), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
