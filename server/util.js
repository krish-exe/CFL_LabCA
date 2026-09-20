import { config } from './config.js';
import { aad, decryptField } from './security/crypto.js';

/** Reads one cookie from the Cookie header (avoids pulling in a cookie-parser dependency). */
export function getCookie(req, name) {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The user fields the browser is allowed to see. */
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
    specialization: user.specialization ?? null,
    totpEnabled: user.totp_enabled,
    mfaRequired: config.mfaRequiredRoles.includes(user.role),
    mustChangePassword: user.must_change_password,
  };
}

export function decryptProfile(user) {
  return {
    phone: decryptField(user.phone_enc, aad('users', 'phone', user.id)),
    dateOfBirth: decryptField(user.date_of_birth_enc, aad('users', 'date_of_birth', user.id)),
  };
}
