// Authentication (who are you?) and role-based access control (what may your role do?).
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { verifyToken } from '../security/tokens.js';
import { audit } from '../security/audit.js';

const unauthorized = (res, message = 'Please sign in again.') =>
  res.status(401).json({ error: message, code: 'UNAUTHENTICATED' });

/**
 * Verifies the Bearer access token and loads the current user from the database on every
 * request, so a deactivated account, a password change or a signed-out session takes effect
 * immediately rather than when the token expires.
 *
 * options.allow               token types accepted (default: only full access tokens)
 * options.allowPasswordChange let through users who still have to change a temporary password
 */
export function authenticate({ allow = ['access'], allowPasswordChange = false } = {}) {
  return async (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return unauthorized(res);

    const payload = verifyToken(token, allow);
    if (!payload) return unauthorized(res);

    const { rows } = await query(
      `SELECT id, email, role, full_name, specialization, is_active, token_version, must_change_password, totp_enabled,
              EXISTS (SELECT 1 FROM refresh_tokens r
                       WHERE r.family_id = $2 AND r.user_id = users.id AND r.revoked_at IS NULL AND r.expires_at > now()) AS session_active
         FROM users WHERE id = $1`,
      [payload.sub, payload.fam ?? null],
    );
    const user = rows[0];
    if (!user || !user.is_active || user.token_version !== payload.tv) return unauthorized(res);
    // Access tokens belong to a sign-in session; once it is signed out or revoked they stop working.
    if (payload.typ === 'access' && !user.session_active) return unauthorized(res);

    // Roles that require 2FA can only hold access tokens minted after a TOTP check.
    if (payload.typ === 'access' && config.mfaRequiredRoles.includes(user.role) && !payload.mfa) {
      return unauthorized(res, 'Two-factor authentication is required for this account.');
    }
    if (user.must_change_password && !allowPasswordChange) {
      return res.status(403).json({ error: 'You must change your temporary password first.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }

    delete user.session_active;
    req.user = { ...user, tokenType: payload.typ, mfa: Boolean(payload.mfa), sessionId: payload.fam ?? null };
    next();
  };
}

/** RBAC gate: only the listed roles get past. Denials are audited. */
export function requireRole(...roles) {
  return async (req, res, next) => {
    if (req.user && roles.includes(req.user.role)) return next();
    await audit(req, {
      action: 'authz.role_denied',
      outcome: 'denied',
      details: { path: req.originalUrl, method: req.method, required: roles },
    });
    res.status(403).json({ error: 'Your role is not allowed to do this.', code: 'FORBIDDEN' });
  };
}

/**
 * Cookie-authenticated endpoints (refresh, logout) need a custom header. Browsers won't send a
 * custom header cross-site without a CORS preflight, which this server never approves, so
 * together with SameSite=Strict cookies this stops cross-site request forgery.
 */
export function requireCsrfHeader(req, res, next) {
  if (req.get('x-requested-with') !== 'SecureClinic') {
    return res.status(403).json({ error: 'Missing anti-CSRF header.', code: 'CSRF' });
  }
  next();
}
