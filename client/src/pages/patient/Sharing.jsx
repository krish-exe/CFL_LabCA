import { useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../components/Icon.jsx';
import { Alert, Badge, Button, Card, Countdown, Empty, Field, Loading, PageHeader, doctorName, formatDateTime, useApi } from '../../components/ui.jsx';

const DURATIONS = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 720, label: '30 days' },
];

function GrantForm({ onGranted }) {
  const doctors = useApi('/doctors');
  const [doctorId, setDoctorId] = useState('');
  const [durationHours, setDuration] = useState(24);
  const [scope, setScope] = useState('read');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/grants', { method: 'POST', body: { doctorId, durationHours, scope } });
      setDoctorId('');
      onGranted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <Field label="Doctor" htmlFor="g-doctor">
        <select id="g-doctor" className="input" value={doctorId} onChange={(e) => setDoctorId(e.target.value)} required>
          <option value="">Choose a doctor…</option>
          {doctors.data?.doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {doctorName(d)} ({d.specialization})
            </option>
          ))}
        </select>
      </Field>
      <Field label="For how long">
        <div className="segmented" role="radiogroup" aria-label="Duration">
          {DURATIONS.map((d) => (
            <button type="button" key={d.hours} role="radio" aria-checked={durationHours === d.hours} className={durationHours === d.hours ? 'active' : ''} onClick={() => setDuration(d.hours)}>
              {d.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="What they can do">
        <div className="choice-grid">
          {[
            { value: 'read', title: 'View only', text: 'See your records and download files.' },
            { value: 'read_write', title: 'View & add', text: 'Also add prescriptions, diagnoses and notes.' },
          ].map((o) => (
            <label key={o.value} className={`choice ${scope === o.value ? 'selected' : ''}`}>
              <input type="radio" name="scope" value={o.value} checked={scope === o.value} onChange={() => setScope(o.value)} />
              <span className="strong">{o.title}</span>
              <span className="muted small">{o.text}</span>
            </label>
          ))}
        </div>
      </Field>
      <div>
        <Button type="submit" busy={busy} disabled={!doctorId} icon="share">
          Share my records
        </Button>
      </div>
    </form>
  );
}

export default function Sharing() {
  const { data, error, loading, reload } = useApi('/grants');
  const [busy, setBusy] = useState(null);
  const grants = data?.grants ?? [];
  const active = grants.filter((g) => g.status === 'active');
  const past = grants.filter((g) => g.status !== 'active');

  async function revoke(id) {
    setBusy(id);
    try {
      await api(`/grants/${id}`, { method: 'DELETE' });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Consent"
        title="Sharing"
        subtitle="Doctors can't see your records unless you allow it. Access ends automatically when the time runs out, or as soon as you revoke it."
      />
      <div className="grid-cards">
        <Card title="Share with a doctor">
          <GrantForm onGranted={reload} />
        </Card>
        <Card title="Active access">
          {loading && !data ? (
            <Loading />
          ) : error ? (
            <Alert tone="danger">{error.message}</Alert>
          ) : active.length === 0 ? (
            <Empty icon="lock" title="Your records are private">
              No doctor has access right now.
            </Empty>
          ) : (
            <ul className="list">
              {active.map((g) => (
                <li key={g.id} className="list-row">
                  <Icon name="stethoscope" size={20} className="list-icon" />
                  <div className="list-main">
                    <p className="strong">{doctorName(g.doctor)}</p>
                    <p className="muted small">
                      {g.scope === 'read_write' ? 'View & add' : 'View only'} · until {formatDateTime(g.expiresAt)}
                    </p>
                  </div>
                  <Countdown until={g.expiresAt} />
                  <Button size="sm" variant="danger" busy={busy === g.id} onClick={() => revoke(g.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {past.length > 0 && (
        <Card title="History" flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Access</th>
                  <th>Granted</th>
                  <th>Ended</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {past.map((g) => (
                  <tr key={g.id}>
                    <td>{doctorName(g.doctor)}</td>
                    <td>{g.scope === 'read_write' ? 'View & add' : 'View only'}</td>
                    <td className="nowrap">{formatDateTime(g.createdAt)}</td>
                    <td className="nowrap">{formatDateTime(g.revokedAt ?? g.expiresAt)}</td>
                    <td>
                      <Badge tone={g.status === 'revoked' ? 'danger' : 'neutral'}>{g.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
