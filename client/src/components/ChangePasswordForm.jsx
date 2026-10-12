import { useState } from 'react';
import { api } from '../api.js';
import PasswordChecklist, { passwordChecks } from './PasswordChecklist.jsx';
import { Alert, Button, Field } from './ui.jsx';

export default function ChangePasswordForm({ email, onChanged, currentLabel = 'Current password' }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const mismatch = form.confirm && form.confirm !== form.newPassword;
  const ok = passwordChecks(form.newPassword, { email }).every((c) => c.ok) && form.confirm && !mismatch;
  const fields = error?.fields ?? {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await api('/auth/change-password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      onChanged(data);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      {error && !fields.currentPassword && !fields.newPassword && <Alert tone="danger">{error.message}</Alert>}
      <Field label={currentLabel} htmlFor="cur-pw" error={fields.currentPassword}>
        <input id="cur-pw" className="input" type="password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} required />
      </Field>
      <Field label="New password" htmlFor="new-pw" error={fields.newPassword}>
        <input id="new-pw" className="input" type="password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} required maxLength={128} />
        <PasswordChecklist password={form.newPassword} email={email} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm-pw" error={mismatch ? 'Passwords do not match.' : null}>
        <input id="confirm-pw" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} required />
      </Field>
      <div>
        <Button type="submit" busy={busy} disabled={!ok}>
          Change password
        </Button>
      </div>
    </form>
  );
}
