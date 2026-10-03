import { SignJWT, jwtVerify } from 'jose';

const encoder = new TextEncoder();

function secret() {
  const value = process.env.APP_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error('APP_SESSION_SECRET must contain at least 32 characters');
  }
  return encoder.encode(value);
}

export async function createSessionToken(userId: string) {
  return new SignJWT({ sub: userId, typ: 'dotacjapro_session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, secret(), {
    algorithms: ['HS256']
  });

  if (payload.typ !== 'dotacjapro_session' || typeof payload.sub !== 'string') {
    throw new Error('Invalid session');
  }

  return { userId: payload.sub };
}
