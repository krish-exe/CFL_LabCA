import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api.js';
import AuthFrame from '../components/AuthFrame.jsx';
import PasswordChecklist, { passwordChecks } from '../components/PasswordChecklist.jsx';
import { Alert, Button, Field } from '../components/ui.jsx';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '', phone: '', dateOfBirth: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const fields = error?.fields ?? {};

  const mismatch = form.confirm && form.confirm !== form.password;
  const policyOk = passwordChecks(form.password, { email: form.email }).every((c) => c.ok);

  async function submit(e) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      const { confirm, ...body } = form;
      if (!body.phone) delete body.phone;
      if (!body.dateOfBirth) delete body.dateOfBirth;
      await api('/auth/register', { method: 'POST', body, noRefresh: true });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame
      title="Create a patient account"
      subtitle="Doctors and staff get their accounts from the clinic administrator."
      footer={
        <>
          Already registered? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="stack" noValidate>
        {error && !Object.keys(fields).length && <Alert tone="danger">{error.message}</Alert>}
        <Field label="Full name" htmlFor="fullName" error={fields.fullName}>
          <input id="fullName" className="input" autoComplete="name" value={form.fullName} onChange={set('fullName')} required maxLength={80} />
        </Field>
        <Field label="Email" htmlFor="reg-email" error={fields.email}>
          <input id="reg-email" className="input" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
        </Field>
        <Field label="Password" htmlFor="reg-password" error={fields.password}>
          <input
            id="reg-password"
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            maxLength={128}
          />
          <PasswordChecklist password={form.password} email={form.email} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={mismatch ? 'Passwords do not match.' : null}>
          <input id="confirm" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
        </Field>
        <div className="grid-2">
          <Field label="Phone (optional)" htmlFor="phone" error={fields.phone}>
            <input id="phone" className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field label="Date of birth (optional)" htmlFor="dob" error={fields.dateOfBirth}>
            <input id="dob" className="input" type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} max={new Date().toISOString().slice(0, 10)} />
          </Field>
        </div>
        <p className="field-hint">Phone and date of birth are encrypted before they are stored.</p>
        <Button type="submit" busy={busy} disabled={!policyOk || mismatch || !form.confirm} className="btn-block">
          Create account
        </Button>
      </form>
    </AuthFrame>
  );
}
