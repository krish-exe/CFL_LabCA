// Creates .env with fresh random secrets and a self-signed TLS certificate for https://localhost.
// Safe to run again: existing secrets and certificates are kept.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import selfsigned from 'selfsigned';
import { root, envPath, readEnv, setEnvValues } from './env-file.mjs';

const hex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// 1. .env with generated secrets
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(root, '.env.example'), envPath);
  console.log('Created .env from .env.example');
}
const env = readEnv();
const generated = {};
if (!env.JWT_ACCESS_SECRET) generated.JWT_ACCESS_SECRET = hex(64);
if (!env.JWT_REFRESH_SECRET) generated.JWT_REFRESH_SECRET = hex(64);
if (!env.DATA_ENCRYPTION_KEY) generated.DATA_ENCRYPTION_KEY = hex(32);
if (!env.AUDIT_HMAC_KEY) generated.AUDIT_HMAC_KEY = hex(32);
if (Object.keys(generated).length) {
  setEnvValues(generated);
  console.log(`Generated secrets: ${Object.keys(generated).join(', ')}`);
} else {
  console.log('Secrets already present in .env, kept');
}

// 2. Self-signed ECDSA P-256 certificate (generated with Node's own WebCrypto, no OpenSSL needed)
const certDir = path.join(root, 'certs');
const certPath = path.join(certDir, 'cert.pem');
const keyPath = path.join(certDir, 'key.pem');
fs.mkdirSync(certDir, { recursive: true });

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log('TLS certificate already exists in certs/, kept');
} else {
  const notBeforeDate = new Date();
  const notAfterDate = new Date(notBeforeDate);
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 1);
  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: 'localhost' },
      { name: 'organizationName', value: 'SecureClinic (development)' },
    ],
    {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    },
  );
  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert);
  console.log('Created self-signed ECDSA P-256 certificate in certs/ (valid 1 year)');
}
