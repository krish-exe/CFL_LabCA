import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../../api.js';
import { Icon } from '../../components/Icon.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, STATUS_TONES, formatDay, formatTime, useApi } from '../../components/ui.jsx';

function NotesEditor({ appointment, onSaved, onClose }) {
  const [notes, setNotes] = useState(appointment.notes ?? '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/appointments/${appointment.id}`, { method: 'PATCH', body: { notes } });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={save}>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <p className="muted">
        {appointment.patient.fullName} · {formatDay(appointment.scheduledAt)}, {formatTime(appointment.scheduledAt)}
      </p>
      <Field label="Visit notes" hint="Visible to the patient. Stored encrypted." htmlFor="notes">
        <textarea id="notes" className="input" rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} autoFocus />
      </Field>
      <div className="row">
        <Button type="submit" busy={busy}>Save notes</Button>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

export default function Schedule() {
  const [tab, setTab] = useState('upcoming');
  const { data, error, loading, reload } = useApi(`/appointments?when=${tab}`);
  const grants = useApi('/grants');
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(null);
  const [actionError, setActionError] = useState(null);

  const shared = new Set(grants.data?.grants.map((g) => g.patient.id));

  async function setStatus(a, status) {
    if (status === 'cancelled' && !window.confirm(`Cancel ${a.patient.fullName}'s appointment?`)) return;
    setBusy(`${a.id}:${status}`);
    setActionError(null);
    try {
      await api(`/appointments/${a.id}`, { method: 'PATCH', body: { status } });
      await reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const groups = [];
  for (const a of data?.appointments ?? []) {
    const key = new Date(a.scheduledAt).toDateString();
    if (groups.at(-1)?.key !== key) groups.push({ key, date: a.scheduledAt, items: [] });
    groups.at(-1).items.push(a);
  }

  return (
    <>
      <PageHeader eyebrow="Clinic" title="Schedule" subtitle="Confirm requests, write visit notes and open the files patients have shared with you." />
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      <Card
        flush
        title={
          <span className="tabs" role="tablist">
            {['upcoming', 'past'].map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t === 'upcoming' ? 'Upcoming' : 'Past'}
              </button>
            ))}
          </span>
        }
      >
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : groups.length === 0 ? (
          <Empty icon="calendar" title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'} />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="day-group">
              <h3 className="day-heading">{formatDay(g.date)}</h3>
              <ul className="appts">
                {g.items.map((a) => (
                  <li key={a.id} className="appt">
                    <div className="appt-when">
                      <span className="appt-date">{formatTime(a.scheduledAt)}</span>
                    </div>
                    <div className="appt-main">
                      <p className="strong">
                        {a.patient.fullName}{' '}
                        {shared.has(a.patient.id) && (
                          <Link className="link small" to={`/patients/${a.patient.id}`}>
                            Open file
                          </Link>
                        )}
                      </p>
                      <p className="muted">{a.reason}</p>
                      {a.notes && (
                        <p className="appt-notes">
                          <Icon name="stethoscope" size={14} /> {a.notes}
                        </p>
                      )}
                    </div>
                    <div className="appt-side">
                      <Badge tone={STATUS_TONES[a.status]}>{a.status}</Badge>
                      <div className="row row-tight">
                        {a.status === 'requested' && (
                          <Button size="sm" busy={busy === `${a.id}:confirmed`} onClick={() => setStatus(a, 'confirmed')}>
                            Confirm
                          </Button>
                        )}
                        {a.status === 'confirmed' && (
                          <Button size="sm" variant="secondary" busy={busy === `${a.id}:completed`} onClick={() => setStatus(a, 'completed')}>
                            Mark done
                          </Button>
                        )}
                        {a.status !== 'cancelled' && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                            Notes
                          </Button>
                        )}
                        {['requested', 'confirmed'].includes(a.status) && (
                          <Button size="sm" variant="ghost" busy={busy === `${a.id}:cancelled`} onClick={() => setStatus(a, 'cancelled')}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Visit notes">
        {editing && (
          <NotesEditor
            appointment={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              reload();
            }}
          />
        )}
      </Modal>
    </>
  );
}
