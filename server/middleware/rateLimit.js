// Rate limiting per client IP. Works alongside per-account lockout (see routes/auth.js):
// the IP limit slows down attacks spread across many accounts, the lockout protects one
// account attacked from many IPs.
import { rateLimit } from 'express-rate-limit';
import { audit } from '../security/audit.js';

const MINUTE = 60 * 1000;

function limiter({ name, windowMs, limit, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    skipSuccessfulRequests,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: async (req, res) => {
      await audit(req, { action: 'security.rate_limited', outcome: 'denied', details: { limiter: name, path: req.originalUrl } }).catch(() => {});
      res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
    },
  });
}

export const createLimiters = () => ({
  api: limiter({ name: 'api', windowMs: 15 * MINUTE, limit: 600 }),
  // Only failed attempts count, so a user who signs in normally is never blocked.
  login: limiter({ name: 'login', windowMs: 15 * MINUTE, limit: 10, skipSuccessfulRequests: true }),
  mfa: limiter({ name: 'mfa', windowMs: 15 * MINUTE, limit: 10, skipSuccessfulRequests: true }),
  register: limiter({ name: 'register', windowMs: 60 * MINUTE, limit: 10 }),
  upload: limiter({ name: 'upload', windowMs: 60 * MINUTE, limit: 30 }),
});
