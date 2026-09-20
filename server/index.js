// Starts SecureClinic over HTTPS (TLS 1.2+). Plain HTTP only answers with a redirect to HTTPS.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

const app = createApp();
const hasCert = fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey);

if (!hasCert) {
  if (config.isProduction) throw new Error('TLS certificate missing. Refusing to start without HTTPS in production.');
  console.warn('No TLS certificate in certs/. Run `npm run setup` to create one. Starting WITHOUT HTTPS (development only).');
  http.createServer(app).listen(config.httpsPort, () => console.log(`SecureClinic (insecure dev mode) on http://localhost:${config.httpsPort}`));
} else {
  const server = https.createServer(
    {
      key: fs.readFileSync(config.tlsKey),
      cert: fs.readFileSync(config.tlsCert),
      minVersion: 'TLSv1.2',
    },
    app,
  );
  server.listen(config.httpsPort, () => console.log(`SecureClinic running on https://localhost:${config.httpsPort}`));

  http
    .createServer((req, res) => {
      // Only redirect to a well-formed hostname, so a forged Host header can't create an open redirect.
      const hostname = (req.headers.host ?? '').split(':')[0];
      const safeHost = /^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)*|\d{1,3}(\.\d{1,3}){3})$/i.test(hostname) ? hostname : 'localhost';
      res.writeHead(301, { Location: `https://${safeHost}:${config.httpsPort}${req.url}` });
      res.end();
    })
    .listen(config.httpPort, () => console.log(`HTTP on http://localhost:${config.httpPort} redirects to HTTPS`));
}

const shutdown = () => pool.end().finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
