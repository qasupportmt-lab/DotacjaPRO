import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyStripeSignature(
  rawBody: Buffer,
  header: string,
  secret: string,
  toleranceSeconds = 300
) {
  const parts = header.split(',').map((item) => item.trim());
  const timestampPart = parts.find((item) => item.startsWith('t='));
  const signatures = parts
    .filter((item) => item.startsWith('v1='))
    .map((item) => item.slice(3));

  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isFinite(timestamp)) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret)
    .update(String(timestamp))
    .update('.')
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expected, 'hex');

  return signatures.some((signature) => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');

    return (
      actual.length === expectedBuffer.length &&
      timingSafeEqual(actual, expectedBuffer)
    );
  });
}

export function readStripeProductMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      paymentLinkUrl: null as string | null,
      paymentLinkId: null as string | null
    };
  }

  const value = metadata as Record<string, unknown>;
  const rawUrl =
    typeof value.stripePaymentLinkUrl === 'string'
      ? value.stripePaymentLinkUrl.trim()
      : '';
  const rawId =
    typeof value.stripePaymentLinkId === 'string'
      ? value.stripePaymentLinkId.trim()
      : '';

  let paymentLinkUrl: string | null = null;
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'buy.stripe.com' ||
        parsed.hostname === 'book.stripe.com')
    ) {
      paymentLinkUrl = parsed.toString();
    }
  } catch {
    paymentLinkUrl = null;
  }

  return {
    paymentLinkUrl,
    paymentLinkId: rawId || null
  };
}
