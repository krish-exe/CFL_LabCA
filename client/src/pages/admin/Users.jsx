import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, formatRelative, useApi } from '../../components/ui.jsx';

function CreateStaff({ onCreated }) {
  const [form, setForm] = useState({ fullName: '', email: '', role: 'doctor', specialization: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const fields = error?.fields ?? {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form };
      if (body.role !== 'doctor' || !body.specialization) delete body.specialization;
      const data = await api('/admin/users', { method: 'POST', body });
      setResult(data);
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <div className="stack">
        <Alert tone="success" title={`Account created for ${result.user.fullName}`}>
          Give them this temporary password through a safe channel. It is shown only once. They must replace it and set up an
          authenticator app when they first sign in.
        </Alert>
        <div className="temp-password">
          <code>{result.temporaryPassword}</code>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(result.temporaryPassword)}>
            Copy
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && !Object.keys(fields).length && <Alert tone="danger">{error.message}</Alert>}
      <Field label="Full name" htmlFor="s-name" error={fields.fullName}>
        <input id="s-name" className="input" value={form.fullName} onChange={set('fullName')} required />
      </Field>
      <Field label="Email" htmlFor="s-email" error={fields.email}>
        <input id="s-email" className="input" type="email" value={form.email} onChange={set('email')} required />
      </Field>
      <div className="grid-2">
        <Field label="Role" htmlFor="s-role">
          <select id="s-role" className="input" value={form.role} onChange={set('role')}>
            <option value="doctor">Doctor</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        {form.role === 'doctor' && (
          <Field label="Specialization" htmlFor="s-spec" error={fields.specialization}>
            <input id="s-spec" className="input" value={form.specialization} onChange={set('specialization')} placeholder="General Medicine" />
          </Field>
        )}
      </div>
      <div>
        <Button type="submit" busy={busy}>Create account</Button>
      </div>
    </form>
  );
}

export default function AdminUsers() {
  const { user: me } = useAuth();
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const params = new URLSearchParams();
  if (role) params.set('role', role);
  if (search) params.set('q', search);
  const { data, error, loading, reload } = useApi(`/admin/users?${params}`);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);

  async function act(id, path, options) {
    setBusy(`${id}${path}`);
    setActionError(null);
    try {
      await api(`/admin/users/${id}${path}`, options);
      await reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Accounts"
        subtitle="Create staff accounts, unlock locked accounts, reset two-factor and deactivate access."
        actions={<Button icon="plus" onClick={() => setCreating(true)}>Add staff</Button>}
      />
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      <Card flush>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(q.trim());
          }}
        >
          <input className="input" type="search" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search accounts" />
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="">All roles</option>
            <option value="patient">Patients</option>
            <option value="doctor">Doctors</option>
            <option value="admin">Admins</option>
          </select>
          <Button type="submit" variant="secondary" icon="search">Search</Button>
        </form>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : data.users.length === 0 ? (
          <Empty icon="users" title="No accounts match" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Last sign-in</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className={u.isActive ? '' : 'row-muted'}>
                    <td>
                      <span className="strong block">{u.role === 'doctor' ? `Dr. ${u.fullName}` : u.fullName}</span>
                      <span className="muted small">{u.email}</span>
                    </td>
                    <td className="capitalize">
                      {u.role}
                      {u.specialization && <span className="muted small block">{u.specialization}</span>}
                    </td>
                    <td>
                      {!u.isActive ? (
                        <Badge tone="neutral">Deactivated</Badge>
                      ) : u.lockedUntil ? (
                        <Badge tone="danger">Locked</Badge>
                      ) : u.mustChangePassword ? (
                        <Badge tone="warn">Temp password</Badge>
                      ) : (
                        <Badge tone="ok">Active</Badge>
                      )}
                    </td>
                    <td>{u.totpEnabled ? <Badge tone="ok">On</Badge> : <span className="muted small">Off</span>}</td>
                    <td className="nowrap muted small">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Never'}</td>
                    <td>
                      <div className="row row-tight row-end">
                        {u.lockedUntil && (
                          <Button size="sm" variant="secondary" busy={busy === `${u.id}/unlock`} onClick={() => act(u.id, '/unlock', { method: 'POST' })}>
                            Unlock
                          </Button>
                        )}
                        {u.totpEnabled && u.id !== me.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            busy={busy === `${u.id}/reset-mfa`}
                            onClick={() => window.confirm(`Reset two-factor for ${u.fullName}? They will set it up again at next sign-in.`) && act(u.id, '/reset-mfa', { method: 'POST' })}
                          >
                            Reset 2FA
                          </Button>
                        )}
                        {u.id !== me.id && (
                          <Button
                            size="sm"
                            variant={u.isActive ? 'ghost' : 'secondary'}
                            busy={busy === `${u.id}`}
                            onClick={() => act(u.id, '', { method: 'PATCH', body: { isActive: !u.isActive } })}
                          >
                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add a staff account">
        <CreateStaff onCreated={reload} />
      </Modal>
    </>
  );
}
