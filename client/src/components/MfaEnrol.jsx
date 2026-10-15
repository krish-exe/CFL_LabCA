import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Alert, Button, Field, Loading } from './ui.jsx';

/**
 * Authenticator-app enrolment: shows the QR code, then confirms one code before 2FA is switched on.
 * `token` is the short-lived setup token during a forced first-login enrolment; omitted, the
 * normal session is used.
 */
export default function MfaEnrol({ token, onDone, onCancel }) {
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Exactly one setup request: a second one would replace the secret behind the QR code.
    if (started.current) return;
    started.current = true;
    api('/auth/mfa/setup', { method: 'POST', token }).then(setSetup, setError);
  }, [token]);

  async function confirm(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api('/auth/mfa/enable', { method: 'POST', body: { code }, token }));
    } catch (err) {
      setError(err);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (!setup && !error) return <Loading label="Generating your secret key" />;

  return (
    <div className="mfa-enrol">
      {error && <Alert tone="danger">{error.message}</Alert>}
      {setup && (
        <>
          <ol className="steps">
            <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</li>
            <li>Scan this QR code, or type the key by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="qr-row">
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width="180" height="180" className="qr" />
            <div className="secret">
              <span className="secret-label">Setup key</span>
              <code>{setup.secret.match(/.{1,4}/g).join(' ')}</code>
              <span className="field-hint">Time-based, SHA-1, 6 digits, 30 seconds. The key is stored encrypted.</span>
            </div>
          </div>
          <form onSubmit={confirm} className="stack">
            <Field label="6-digit code" htmlFor="enrol-code">
              <input
                id="enrol-code"
                className="input input-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
              />
            </Field>
            <div className="row">
              <Button type="submit" busy={busy} disabled={code.length !== 6}>
                Turn on two-factor
              </Button>
              {onCancel && (
                <Button variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </>
      )}
    </div>
  );
}
