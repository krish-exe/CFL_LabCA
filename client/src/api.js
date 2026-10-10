// API client. The access token lives only in this module's memory (never localStorage, where an
// XSS payload could read it). The refresh token is an HttpOnly cookie the page can't read at all.
let accessToken = null;
let refreshInFlight = null;
const listeners = { session: () => {}, end: () => {} };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.body = body ?? {};
    this.code = body?.code;
  }
  /** Map of field name -> message from a validation error. */
  get fields() {
    return Object.fromEntries((this.body.fields ?? []).map((f) => [f.field, f.message]));
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

export function onSessionChange({ session, end }) {
  listeners.session = session;
  listeners.end = end;
}

async function send(path, { method = 'GET', body, form, token } = {}) {
  // The custom header is the anti-CSRF check for cookie-authenticated endpoints.
  const headers = { 'X-Requested-With': 'SecureClinic' };
  const bearer = token ?? accessToken;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  return fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession() {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'X-Requested-With': 'SecureClinic' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = await res.json();
      accessToken = data.accessToken;
      listeners.session(data.user);
      return data.user;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Calls the API and returns parsed JSON (or a Blob with { blob: true }). On a 401 it tries one
 * silent refresh and retries; if that fails the session has ended.
 */
export async function api(path, options = {}) {
  let res = await send(path, options);
  if (res.status === 401 && !options.token && !options.noRefresh && accessToken !== null) {
    const user = await refreshSession();
    if (user) res = await send(path, options);
    else listeners.end();
  }
  if (res.ok && options.blob) return res.blob();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
