// Time-based one-time passwords (RFC 6238 TOTP over RFC 4226 HOTP), compatible with
// Google Authenticator, Microsoft Authenticator, Authy and similar apps.
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD = 30;
const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
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

export function base32Decode(text) {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit random secret, base32 encoded (the format authenticator apps expect). */
export const generateSecret = () => base32Encode(crypto.randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD);

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(code).padStart(DIGITS, '0');
}

export const generateTotp = (secret, step = currentStep()) => hotp(secret, step);

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched time step, or null. Codes at or before `lastStep` are rejected
 * so an intercepted code can't be replayed.
 */
export function verifyTotp(secret, code, { lastStep = null, window = 1 } = {}) {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentStep();
  for (let step = now - window; step <= now + window; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export function otpauthUrl(secret, accountName) {
  const label = encodeURIComponent(`SecureClinic:${accountName}`);
  const params = new URLSearchParams({ secret, issuer: 'SecureClinic', algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD) });
  return `otpauth://totp/${label}?${params}`;
}
