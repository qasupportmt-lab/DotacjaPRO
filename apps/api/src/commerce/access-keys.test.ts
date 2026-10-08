import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCESS_KEY_PATTERN, generateAccessKey, hashAccessKey } from './access-keys.js';

test('access key has expected versioned high-entropy format', () => {
  const first = generateAccessKey();
  const second = generateAccessKey();

  assert.match(first, ACCESS_KEY_PATTERN);
  assert.match(second, ACCESS_KEY_PATTERN);
  assert.notEqual(first, second);
  assert.equal(first.length, 47);
});

test('access key hash is deterministic SHA-256 and does not contain plaintext', () => {
  const accessKey = 'ak1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
  const hashA = hashAccessKey(accessKey);
  const hashB = hashAccessKey(accessKey);

  assert.equal(hashA, hashB);
  assert.match(hashA, /^[a-f0-9]{64}$/);
  assert.ok(!hashA.includes(accessKey));
});
