// JSON Web Tokens. Access tokens are short-lived (15 min) and kept only in browser memory;
// refresh tokens live in an HttpOnly cookie and are rotated on every use.
//
// Every token carries a `typ` claim and verification checks it, so a refresh token or a
// half-finished MFA challenge token can never be used as an access token. The algorithm is
// pinned to HS256, which blocks "alg: none" and algorithm-confusion attacks.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

const { issuer, audience } = config.jwt;
const SECRETS = {
  access: config.jwt.accessSecret,
  'mfa-login': config.jwt.accessSecret,
  'mfa-setup': config.jwt.accessSecret,
  refresh: config.jwt.refreshSecret,
};

function sign(typ, subject, claims, expiresIn, jwtid = crypto.randomUUID()) {
  return jwt.sign({ typ, ...claims }, SECRETS[typ], { algorithm: 'HS256', issuer, audience, subject, expiresIn, jwtid });
}

/** `familyId` ties the access token to its sign-in session, so ending the session ends the token too. */
export function signAccessToken(user, { mfa, familyId }) {
  return sign('access', user.id, { role: user.role, tv: user.token_version, mfa: Boolean(mfa), fam: familyId }, config.jwt.accessTtlSeconds);
}

/** Short-lived token proving the password step passed; only usable for the MFA step named by typ. */
export function signChallengeToken(user, typ) {
  return sign(typ, user.id, { tv: user.token_version }, config.jwt.challengeTtlSeconds);
}

export function signRefreshToken(user, { jti, familyId, mfa }) {
  return sign('refresh', user.id, { fam: familyId, tv: user.token_version, mfa: Boolean(mfa) }, config.jwt.refreshTtlSeconds, jti);
}

/**
 * Verifies signature, algorithm, issuer, audience, expiry and token type.
 * Returns the payload, or null if anything is wrong.
 */
export function verifyToken(token, allowedTypes, { ignoreExpiration = false } = {}) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  for (const typ of allowedTypes) {
    try {
      const payload = jwt.verify(token, SECRETS[typ], { algorithms: ['HS256'], issuer, audience, ignoreExpiration });
      if (allowedTypes.includes(payload.typ) && SECRETS[payload.typ] === SECRETS[typ]) return payload;
    } catch {
      // try the next secret
    }
  }
  return null;
}
