import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totpAt, verifyTotp } from './totp';

// RFC 6238 appendix B (SHA-1): secret "12345678901234567890"; 6-digit codes are the last 6 of the 8.
const SECRET = base32Encode(Buffer.from('12345678901234567890'));
const VECTORS: [number, string][] = [
  [59, '287082'],
  [1111111109, '081804'],
  [1111111111, '050471'],
  [1234567890, '005924'],
  [2000000000, '279037'],
];

test('totp matches the RFC 6238 test vectors', () => {
  for (const [t, code] of VECTORS) assert.equal(totpAt(SECRET, Math.floor(t / 30)), code, `t=${t}`);
});

test('base32 round-trips', () => {
  const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
});

test('verifyTotp accepts ±1 step and returns the matched step', () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  assert.equal(verifyTotp(SECRET, totpAt(SECRET, step), now), step);
  assert.equal(verifyTotp(SECRET, totpAt(SECRET, step - 1), now), step - 1);
  assert.equal(verifyTotp(SECRET, totpAt(SECRET, step + 1), now), step + 1);
  assert.equal(verifyTotp(SECRET, totpAt(SECRET, step - 3), now), null);
  assert.equal(verifyTotp(SECRET, '000000', now) === null || totpAt(SECRET, step) === '000000', true);
});

test('secrets are encrypted at rest and tamper-evident', () => {
  const key = 'x'.repeat(40);
  const blob = encryptSecret(SECRET, key);
  assert.notEqual(blob.includes(SECRET), true);
  assert.equal(decryptSecret(blob, key), SECRET);
  assert.throws(() => decryptSecret(blob, 'y'.repeat(40)));
  const [iv, tag, data] = blob.split('.');
  const flipped = Buffer.from(data!, 'base64url');
  flipped[0] = flipped[0]! ^ 1;
  assert.throws(() => decryptSecret([iv, tag, flipped.toString('base64url')].join('.'), key));
});
