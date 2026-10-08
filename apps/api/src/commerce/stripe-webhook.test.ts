import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  readStripeProductMetadata,
  verifyStripeSignature
} from './stripe-webhook.js';

test('verifies a valid Stripe v1 signature and rejects a tampered body', () => {
  const secret = 'whsec_test_only_value';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = Buffer.from('{"id":"evt_test","type":"checkout.session.completed"}');
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');

  const header = `t=${timestamp},v1=${signature}`;

  assert.equal(
    verifyStripeSignature(body, header, secret),
    true
  );
  assert.equal(
    verifyStripeSignature(
      Buffer.from('{"id":"evt_tampered"}'),
      header,
      secret
    ),
    false
  );
});

test('rejects an expired Stripe signature', () => {
  const secret = 'whsec_test_only_value';
  const timestamp = Math.floor(Date.now() / 1000) - 1000;
  const body = Buffer.from('{}');
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest('hex');

  assert.equal(
    verifyStripeSignature(
      body,
      `t=${timestamp},v1=${signature}`,
      secret,
      300
    ),
    false
  );
});

test('accepts only Stripe-hosted Payment Link URLs', () => {
  const valid = readStripeProductMetadata({
    stripePaymentLinkUrl: 'https://buy.stripe.com/example',
    stripePaymentLinkId: 'plink_example'
  });
  assert.equal(valid.paymentLinkUrl, 'https://buy.stripe.com/example');
  assert.equal(valid.paymentLinkId, 'plink_example');

  const invalid = readStripeProductMetadata({
    stripePaymentLinkUrl: 'https://stripe.example.com/phishing',
    stripePaymentLinkId: 'plink_example'
  });
  assert.equal(invalid.paymentLinkUrl, null);
});
