// Central configuration. Fails fast at startup if a required secret is missing or weak.
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function required(name, { hexBytes } = {}) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}. Run \`npm run setup\`.`);
  if (hexBytes && !new RegExp(`^[0-9a-fA-F]{${hexBytes * 2}}$`).test(value)) {
    throw new Error(`${name} must be exactly ${hexBytes} bytes of hex (${hexBytes * 2} characters).`);
  }
  if (!hexBytes && value.length < 32) throw new Error(`${name} is too short; use at least 32 random characters.`);
  return value;
}

export const config = {
  root,
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: required('DATABASE_URL'),
  httpsPort: Number(process.env.HTTPS_PORT || 8443),
  httpPort: Number(process.env.HTTP_PORT || 8080),
  tlsCert: path.resolve(root, process.env.TLS_CERT || 'certs/cert.pem'),
  tlsKey: path.resolve(root, process.env.TLS_KEY || 'certs/key.pem'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    issuer: 'secureclinic',
    audience: 'secureclinic-web',
    accessTtlSeconds: 15 * 60,
    refreshTtlSeconds: 7 * 24 * 60 * 60,
    challengeTtlSeconds: 5 * 60,
  },

  dataKey: Buffer.from(required('DATA_ENCRYPTION_KEY', { hexBytes: 32 }), 'hex'),
  auditKey: Buffer.from(required('AUDIT_HMAC_KEY', { hexBytes: 32 }), 'hex'),

  mfaRequiredRoles: (process.env.MFA_REQUIRED_ROLES || 'admin,doctor').split(',').map((r) => r.trim()).filter(Boolean),

  lockout: { maxAttempts: 5, minutes: 15 },

  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || 'storage/uploads'),
  maxUploadBytes: 5 * 1024 * 1024,

  clinicTzOffset: process.env.CLINIC_TZ_OFFSET || '+05:30',
  clientDist: path.join(root, 'dist'),
};
