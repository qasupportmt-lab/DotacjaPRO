import crypto from 'node:crypto';

export type TelegramWebAppUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type ValidatedTelegramInitData = {
  authDate: number;
  queryId?: string;
  user: TelegramWebAppUser;
};

export function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 3600
): ValidatedTelegramInitData {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Missing Telegram hash');

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();

  const expectedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const expected = Buffer.from(expectedHash, 'hex');
  const received = Buffer.from(receivedHash, 'hex');

  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    throw new Error('Invalid Telegram signature');
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) {
    throw new Error('Invalid Telegram auth_date');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds || authDate - now > 30) {
    throw new Error('Expired Telegram init data');
  }

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Missing Telegram user');

  const user = JSON.parse(rawUser) as TelegramWebAppUser;
  if (!user.id || !user.first_name) throw new Error('Invalid Telegram user');

  return {
    authDate,
    queryId: params.get('query_id') ?? undefined,
    user
  };
}
