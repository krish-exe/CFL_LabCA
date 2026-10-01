// Error handling: clients get short, generic messages; details stay in the server log.
import multer from 'multer';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// 404 rather than 403 for objects the caller may not see, so ids can't be probed for existence.
export const notFound = (what = 'Not found') => new HttpError(404, what);

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err instanceof multer.MulterError) {
    const tooLarge = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'File is larger than 5 MB.' : 'Invalid upload.' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
