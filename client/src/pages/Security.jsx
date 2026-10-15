import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import ChangePasswordForm from '../components/ChangePasswordForm.jsx';
import MfaEnrol from '../components/MfaEnrol.jsx';
import { Icon } from '../components/Icon.jsx';
import { Alert, Badge, Button, Card, Field, Loading, PageHeader, formatDateTime, formatRelative, useApi } from '../components/ui.jsx';

function describeAgent(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /node|undici/i.test(ua) ? 'Script / API client' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function Profile() {
  const { user } = useAuth();
  const me = useApi('/auth/me');
  const [form, setForm] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  if (me.loading) return <Loading />;
  if (me.error) return <Alert tone="danger">{me.error.message}</Alert>;
  const profile = me.data.user;
  const values = form ?? { phone: profile.phone ?? '', dateOfBirth: profile.dateOfBirth ?? '' };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      await api('/me/profile', { method: 'PATCH', body: values });
      setStatus({ tone: 'success', text: 'Saved. These details are stored encrypted.' });
      me.reload();
      setForm(null);
    } catch (err) {
      setStatus({ tone: 'danger', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <dl className="facts">
        <div>
          <dt>Name</dt>
          <dd>{user.role === 'doctor' ? `Dr. ${profile.fullName}` : profile.fullName}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd className="capitalize">{profile.role}{profile.specialization ? ` · ${profile.specialization}` : ''}</dd>
        </div>
        <div>
          <dt>Password last changed</dt>
          <dd>{formatDateTime(profile.passwordChangedAt)}</dd>
        </div>
      </dl>
      {user.role === 'patient' && (
        <form className="stack" onSubmit={save}>
          {status && <Alert tone={status.tone}>{status.text}</Alert>}
          <div className="grid-2">
            <Field label="Phone" htmlFor="p-phone">
              <input id="p-phone" className="input" type="tel" value={values.phone} onChange={(e) => setForm({ ...values, phone: e.target.value })} />
            </Field>
            <Field label="Date of birth" htmlFor="p-dob">
              <input id="p-dob" className="input" type="date" value={values.dateOfBirth} onChange={(e) => setForm({ ...values, dateOfBirth: e.target.value })} />
            </Field>
          </div>
          <div>
            <Button type="submit" variant="secondary" busy={busy} disabled={!form}>
              Save details
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function TwoFactor() {
  const { user, completeLogin } = useAuth();
  const [mode, setMode] = useState(null);
  const [form, setForm] = useState({ password: '', code: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const enabled = (data) => {
    completeLogin(data);
    setMode(null);
    setNotice('Two-factor authentication is on. Other devices were signed out.');
  };

  async function disable(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      completeLogin(await api('/auth/mfa/disable', { method: 'POST', body: form }));
      setMode(null);
      setForm({ password: '', code: '' });
      setNotice('Two-factor authentication is off.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'enrol') return <MfaEnrol onDone={enabled} onCancel={() => setMode(null)} />;

  return (
    <div className="stack">
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="split-row">
        <div>
          <p className="strong">
            Authenticator app {user.totpEnabled ? <Badge tone="ok">On</Badge> : <Badge tone="warn">Off</Badge>}
          </p>
          <p className="muted">
            {user.mfaRequired
              ? 'Required for your role. Every sign-in needs a code from your phone.'
              : 'Adds a 6-digit code from your phone to every sign-in, so a stolen password alone is not enough.'}
          </p>
        </div>
        {!user.totpEnabled && <Button onClick={() => setMode('enrol')} icon="shield">Turn on</Button>}
        {user.totpEnabled && !user.mfaRequired && mode !== 'disable' && (
          <Button variant="secondary" onClick={() => setMode('disable')}>Turn off</Button>
        )}
      </div>
      {mode === 'disable' && (
        <form className="stack inset" onSubmit={disable}>
          {error && <Alert tone="danger">{error.message}</Alert>}
          <div className="grid-2">
            <Field label="Password" htmlFor="d-pw">
              <input id="d-pw" className="input" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </Field>
            <Field label="Current code" htmlFor="d-code">
              <input id="d-code" className="input input-code" inputMode="numeric" maxLength={6} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} required />
            </Field>
          </div>
          <div className="row">
            <Button type="submit" variant="danger" busy={busy}>Turn off two-factor</Button>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function Sessions() {
  const { logout } = useAuth();
  const { data, error, loading, reload } = useApi('/auth/sessions');
  const [busy, setBusy] = useState(null);

  async function revoke(id) {
    setBusy(id);
    try {
      await api(`/auth/sessions/${id}`, { method: 'DELETE' });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function everywhere() {
    setBusy('all');
    await api('/auth/logout-all', { method: 'POST' }).catch(() => {});
    await logout();
  }

  if (loading && !data) return <Loading />;
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  return (
    <div className="stack">
      <ul className="list">
        {data.sessions.map((s) => (
          <li key={s.id} className="list-row">
            <Icon name="device" size={20} className="list-icon" />
            <div className="list-main">
              <p className="strong">
                {describeAgent(s.userAgent)} {s.current && <Badge tone="accent">This device</Badge>}
              </p>
              <p className="muted small">
                Signed in {formatDateTime(s.startedAt)} · active {formatRelative(s.lastActive)} · IP {s.ip ?? 'unknown'}
              </p>
            </div>
            {!s.current && (
              <Button size="sm" variant="ghost" busy={busy === s.id} onClick={() => revoke(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" icon="logout" busy={busy === 'all'} onClick={everywhere}>
          Sign out everywhere
        </Button>
      </div>
    </div>
  );
}

export default function Security() {
  const { user, completeLogin } = useAuth();
  const [pwNotice, setPwNotice] = useState(false);
  return (
    <>
      <PageHeader eyebrow="Account" title="Security" subtitle="Your sign-in methods, password and active sessions." />
      <div className="grid-cards">
        <Card title="Profile">
          <Profile />
        </Card>
        <Card title="Two-factor authentication">
          <TwoFactor />
        </Card>
        <Card title="Password" subtitle="Changing it signs you out on every other device.">
          {pwNotice && <Alert tone="success">Password changed. Other devices were signed out.</Alert>}
          <ChangePasswordForm
            email={user.email}
            onChanged={(data) => {
              completeLogin(data);
              setPwNotice(true);
            }}
          />
        </Card>
        <Card title="Where you're signed in" subtitle="Sessions last up to 7 days. Refresh tokens rotate on every use.">
          <Sessions />
        </Card>
      </div>
    </>
  );
}
