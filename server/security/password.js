// Password hashing with Argon2id (memory-hard, salted) and the password policy.
import { randomInt as cryptoInt } from 'node:crypto';
import argon2 from 'argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, OPTIONS);

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export const needsRehash = (hash) => argon2.needsRehash(hash, OPTIONS);

// When the email doesn't exist we still run one Argon2 verification, so the response time
// doesn't reveal which emails are registered.
let dummyHash;
export async function burnVerifyTime(password) {
  dummyHash ??= await hashPassword('not-a-real-account-password');
  await verifyPassword(dummyHash, password);
  return false;
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'qwertyuiop', 'iloveyou', 'admin', 'admin123', 'welcome',
  'welcome1', 'letmein', 'monkey', 'dragon', 'football', 'baseball', 'abc123', '111111', '000000',
  'sunshine', 'princess', 'trustno1', 'superman', 'p@ssw0rd', 'p@ssword1', 'password@123',
  'india@123', 'india123', 'doctor123', 'hospital', 'clinic123', 'secureclinic', 'changeme',
]);

/** Returns a list of policy violations (empty when the password is acceptable). */
export function checkPasswordPolicy(password, { email = '', fullName = '' } = {}) {
  const problems = [];
  const lower = password.toLowerCase();
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (password.length > 128) problems.push('Use at most 128 characters.');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) problems.push('Mix at least three of: lowercase, uppercase, digits, symbols.');
  if (COMMON_PASSWORDS.has(lower)) problems.push('This password is too common.');
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) problems.push('Do not include your email address.');
  for (const part of fullName.toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      problems.push('Do not include your name.');
      break;
    }
  }
  if (/(.)\1{3,}/.test(password)) problems.push('Avoid repeating the same character.');
  return problems;
}

/** Random temporary password that satisfies the policy (for admin-created accounts). */
export function generateTemporaryPassword() {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+'];
  const all = sets.join('');
  const pick = (chars) => chars[cryptoInt(chars.length)];
  const chars = sets.map(pick);
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = cryptoInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
