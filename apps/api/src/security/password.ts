import crypto from 'node:crypto';

const KEY_LENGTH = 64;
const N = 16_384;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, n = N, r = R, p = P) {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      }
    );
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await derive(password, salt);
  return [
    'scrypt',
    String(N),
    String(R),
    String(P),
    salt.toString('base64url'),
    hash.toString('base64url')
  ].join('$');
}

export async function passwordMatches(password: string, encoded: string) {
  const [algorithm, nRaw, rRaw, pRaw, saltRaw, hashRaw] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    !nRaw ||
    !rRaw ||
    !pRaw ||
    !saltRaw ||
    !hashRaw
  ) {
    return false;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const expected = Buffer.from(hashRaw, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await derive(
    password,
    Buffer.from(saltRaw, 'base64url'),
    n,
    r,
    p
  );

  return (
    actual.length === expected.length &&
    crypto.timingSafeEqual(actual, expected)
  );
}
