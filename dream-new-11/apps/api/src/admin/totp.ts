import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — what Google Authenticator, Authy and 1Password use. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Accepts the current step ±1 (clock drift). Returns the matched step so callers can reject
 * replays (a step at or before the last accepted one), or null if the code is wrong.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpAt(secret, s));
    const given = Buffer.from(code.padStart(DIGITS, '0').slice(0, DIGITS));
    if (expected.length === given.length && timingSafeEqual(expected, given)) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, account: string, issuer = 'Dream New 11 Admin') =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;

/** Secrets are encrypted at rest with a key derived from the server secret. */
function key(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, 'dream-new-11', 'admin-mfa-v1', 32));
}

export function encryptSecret(secret: string, serverSecret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(serverSecret), iv);
  const data = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(blob: string, serverSecret: string): string {
  const [iv, tag, data] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key(serverSecret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(data!), d.final()]).toString('utf8');
}
