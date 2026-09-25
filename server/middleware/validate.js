// Input validation and normalisation with zod. Schemas are strict allowlists: unknown fields
// are dropped, types, lengths and formats are enforced, and free text is normalised before it
// reaches the database. (SQL injection is separately prevented by parameterised queries, and
// XSS by React's output encoding plus the Content-Security-Policy.)
import { z } from 'zod';

// Strip ASCII control characters (keeping tab and newline) and normalise Unicode.
const clean = (s) => s.normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

export const text = (max, min = 0) => z.string().transform(clean).pipe(z.string().min(min).max(max));
export const optionalText = (max) => text(max).optional().transform((v) => v || null);

export const personName = z
  .string()
  .transform(clean)
  .pipe(z.string().min(2).max(80).regex(/^[\p{L}][\p{L}\p{M} .'-]*$/u, 'Use letters, spaces, apostrophes, dots or hyphens only.'));

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const password = z.string().min(1).max(128);
export const uuid = z.uuid();
export const otpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');
export const phone = z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

export const idParam = z.object({ id: uuid });

/** validate({ body, params, query }) puts parsed values on req.valid.body / .params / .query */
export const validate = (schemas) => (req, res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    if (!schemas[part]) continue;
    const result = schemas[part].safeParse(req[part] ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: 'Some fields are invalid.',
        fields: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    req.valid[part] = result.data;
  }
  next();
};
