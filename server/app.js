import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { createLimiters } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errors.js';
import { authRoutes } from './routes/auth.js';
import { doctorRoutes } from './routes/doctors.js';
import { appointmentRoutes } from './routes/appointments.js';
import { recordRoutes } from './routes/records.js';
import { grantRoutes } from './routes/grants.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';

export function createApp() {
  const app = express();
  const limiters = createLimiters();

  app.disable('x-powered-by');

  // Security headers. The CSP only allows scripts, styles and connections from this origin, which
  // blocks injected scripts even if one slipped through; frame-ancestors 'none' stops clickjacking.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      // HSTS is set below, so it can be skipped for the bare hostname "localhost".
      strictTransportSecurity: false,
      xFrameOptions: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    // HSTS makes browsers refuse plain HTTP for this host for a year. Browsers apply it to every
    // port, so on "localhost" it would break all other local dev servers; we send it for real
    // hostnames (and IPs such as 127.0.0.1, where browsers ignore it but the header is visible).
    if (req.secure && req.hostname !== 'localhost') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  // API: rate limited, small JSON bodies only, never cached (responses contain health data).
  app.use('/api', limiters.api, express.json({ limit: '100kb' }), (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(limiters));
  app.use('/api/doctors', doctorRoutes());
  app.use('/api/appointments', appointmentRoutes());
  app.use('/api/records', recordRoutes(limiters));
  app.use('/api/grants', grantRoutes());
  app.use('/api/me', meRoutes());
  app.use('/api/admin', adminRoutes());
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // The built React app (npm run build). In development Vite serves it instead.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use(errorHandler);
  return app;
}
