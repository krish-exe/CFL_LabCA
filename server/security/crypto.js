// AES-256-GCM encryption for sensitive database fields and uploaded files.
//
// - Sub-keys are derived from the single master key with HKDF, so field encryption and
//   file-key wrapping never share a key.
// - Every value gets a fresh random 96-bit IV; GCM's auth tag detects any modification.
// - Associated data (AAD) binds each ciphertext to its table, column and row id, so a
//   ciphertext copied into another row or column fails to decrypt.
// - Files use envelope encryption: each file has its own random data key, stored wrapped
//   (encrypted) by the master-derived wrapping key.
import crypto from 'node:crypto';
import { config } from '../config.js';

const subkey = (info) => Buffer.from(crypto.hkdfSync('sha256', config.dataKey, Buffer.alloc(0), info, 32));
const FIELD_KEY = subkey('secureclinic/field/v1');
const WRAP_KEY = subkey('secureclinic/key-wrap/v1');
const VERSION = 'v1';

function seal(key, plaintext, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key, { iv, tag, ciphertext }, aad) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function toToken({ iv, tag, ciphertext }) {
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function fromToken(token) {
  const [version, iv, tag, ciphertext] = String(token).split(':');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error('Unrecognised ciphertext format');
  return { iv: Buffer.from(iv, 'base64'), tag: Buffer.from(tag, 'base64'), ciphertext: Buffer.from(ciphertext, 'base64') };
}

/** AAD string for a field: binds ciphertext to table.column and row id. */
export const aad = (table, column, id) => `${table}.${column}:${id}`;

export function encryptField(value, aadString) {
  if (value === null || value === undefined || value === '') return null;
  return toToken(seal(FIELD_KEY, Buffer.from(String(value), 'utf8'), aadString));
}

export function decryptField(token, aadString) {
  if (!token) return null;
  return open(FIELD_KEY, fromToken(token), aadString).toString('utf8');
}

/** New random per-file key plus its wrapped form for storage. */
export function newFileKey(recordId) {
  const key = crypto.randomBytes(32);
  return { key, wrapped: toToken(seal(WRAP_KEY, key, aad('medical_records', 'file_key', recordId))) };
}

export function unwrapFileKey(wrapped, recordId) {
  return open(WRAP_KEY, fromToken(wrapped), aad('medical_records', 'file_key', recordId));
}

/** Encrypted file layout: [12-byte IV][16-byte tag][ciphertext]. */
export function encryptFile(buffer, key, aadString) {
  const { iv, tag, ciphertext } = seal(key, buffer, aadString);
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptFile(blob, key, aadString) {
  return open(key, { iv: blob.subarray(0, 12), tag: blob.subarray(12, 28), ciphertext: blob.subarray(28) }, aadString);
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
