import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import AuthFrame from '../components/AuthFrame.jsx';
import MfaEnrol from '../components/MfaEnrol.jsx';
import { Alert, Button, Field } from '../components/ui.jsx';

export default function Login() {
  const { completeLogin } = useAuth();
  const location = useLocation();
  const [step, setStep] = useState({ name: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await api('/auth/login', { method: 'POST', body: { email, password }, noRefresh: true });
      setPassword('');
      if (data.mfaRequired) setStep({ name: 'mfa', token: data.mfaToken });
      else if (data.mfaSetupRequired) setStep({ name: 'setup', token: data.setupToken });
      else completeLogin(data);
    });
  };

  const submitCode = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        completeLogin(await api('/auth/mfa/verify', { method: 'POST', body: { mfaToken: step.token, code }, noRefresh: true }));
      } catch (err) {
        setCode('');
        if (err.code === 'MFA_EXPIRED') setStep({ name: 'password' });
        throw err;
      }
    });
  };

  const errorBox = error && (
    <Alert tone={error.status === 423 || error.status === 429 ? 'warn' : 'danger'} title={error.status === 423 ? 'Account locked' : undefined}>
      {error.message}
    </Alert>
  );

  if (step.name === 'setup') {
    return (
      <AuthFrame title="Set up two-factor authentication" subtitle="Doctors and administrators must use an authenticator app. This takes about a minute.">
        <MfaEnrol token={step.token} onDone={completeLogin} onCancel={() => setStep({ name: 'password' })} />
      </AuthFrame>
    );
  }

  if (step.name === 'mfa') {
    return (
      <AuthFrame title="Enter your code" subtitle="Open your authenticator app and enter the 6-digit code for SecureClinic.">
        <form onSubmit={submitCode} className="stack">
          {errorBox}
          <Field label="Authentication code" htmlFor="code">
            <input
              id="code"
              className="input input-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
          </Field>
          <Button type="submit" busy={busy} disabled={code.length !== 6} className="btn-block">
            Verify and sign in
          </Button>
          <Button variant="ghost" onClick={() => setStep({ name: 'password' })} className="btn-block">
            Use a different account
          </Button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title="Sign in"
      subtitle="Welcome back. Sign in to manage appointments and records."
      footer={
        <>
          New patient? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <form onSubmit={submitPassword} className="stack">
        {location.state?.registered && <Alert tone="success">Account created. Sign in with your new password.</Alert>}
        {errorBox}
        <Field label="Email" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Button type="submit" busy={busy} className="btn-block">
          Continue
        </Button>
      </form>
    </AuthFrame>
  );
}
