import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon } from '../../components/Icon.jsx';
import { Alert, Badge, Button, Card, Empty, Field, Loading, Modal, PageHeader, STATUS_TONES, doctorName, formatDateTime, formatTime, initials, useApi } from '../../components/ui.jsx';

/** Next 14 bookable days (the clinic is closed on Sundays), as YYYY-MM-DD in local time. */
function upcomingDays() {
  const days = [];
  for (let i = 0; days.length < 12; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (d.getDay() === 0) continue;
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ iso, weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }), day: d.getDate(), month: d.toLocaleDateString('en-IN', { month: 'short' }) });
  }
  return days;
}

function Booking({ onBooked, onCancel }) {
  const doctors = useApi('/doctors');
  const days = useMemo(upcomingDays, []);
  const [doctorId, setDoctorId] = useState(null);
  const [date, setDate] = useState(days[0].iso);
  const [slots, setSlots] = useState(null);
  const [slot, setSlot] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!doctorId) return;
    let live = true;
    setSlots(null);
    setSlot(null);
    api(`/doctors/${doctorId}/slots?date=${date}`).then(
      (d) => live && setSlots(d.slots),
      (e) => live && setError(e),
    );
    return () => {
      live = false;
    };
  }, [doctorId, date]);

  async function book(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/appointments', { method: 'POST', body: { doctorId, scheduledAt: slot, reason } });
      onBooked();
    } catch (err) {
      setError(err);
      if (err.status === 409) setSlots((s) => s?.map((x) => (x.at === slot ? { ...x, available: false } : x)));
    } finally {
      setBusy(false);
    }
  }

  if (doctors.loading) return <Loading />;
  return (
    <form className="stack" onSubmit={book}>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <fieldset className="fieldset">
        <legend>1. Choose a doctor</legend>
        <div className="doctor-grid">
          {doctors.data.doctors.map((d) => (
            <button type="button" key={d.id} className={`doctor-card ${doctorId === d.id ? 'selected' : ''}`} onClick={() => setDoctorId(d.id)} aria-pressed={doctorId === d.id}>
              <span className="avatar">{initials(d.fullName)}</span>
              <span>
                <span className="strong">{doctorName(d)}</span>
                <span className="muted small block">{d.specialization}</span>
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      {doctorId && (
        <fieldset className="fieldset">
          <legend>2. Pick a day and time</legend>
          <div className="day-strip" role="group" aria-label="Day">
            {days.map((d) => (
              <button type="button" key={d.iso} className={`day ${date === d.iso ? 'selected' : ''}`} onClick={() => setDate(d.iso)} aria-pressed={date === d.iso}>
                <span className="small">{d.weekday}</span>
                <span className="day-num">{d.day}</span>
                <span className="small">{d.month}</span>
              </button>
            ))}
          </div>
          {!slots ? (
            <Loading label="Checking availability" />
          ) : slots.length === 0 ? (
            <p className="muted">No times left on this day.</p>
          ) : (
            <div className="slot-grid" role="group" aria-label="Time">
              {slots.map((s) => (
                <button type="button" key={s.at} disabled={!s.available} className={`slot ${slot === s.at ? 'selected' : ''}`} onClick={() => setSlot(s.at)} aria-pressed={slot === s.at}>
                  {formatTime(s.at)}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      {slot && (
        <fieldset className="fieldset">
          <legend>3. Reason for the visit</legend>
          <Field hint="Only you and this doctor can read it. It's stored encrypted." htmlFor="reason">
            <textarea id="reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} placeholder="Describe your symptoms or the purpose of the visit" />
          </Field>
        </fieldset>
      )}

      <div className="row">
        <Button type="submit" busy={busy} disabled={!slot || reason.trim().length < 3} icon="calendar">
          {slot ? `Request ${formatDateTime(slot)}` : 'Request appointment'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AppointmentRow({ a, onChanged }) {
  const [busy, setBusy] = useState(false);
  const canCancel = ['requested', 'confirmed'].includes(a.status) && new Date(a.scheduledAt) > new Date();
  async function cancel() {
    if (!window.confirm('Cancel this appointment?')) return;
    setBusy(true);
    try {
      await api(`/appointments/${a.id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="appt">
      <div className="appt-when">
        <span className="appt-date">{new Date(a.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
        <span className="muted small">{formatTime(a.scheduledAt)}</span>
      </div>
      <div className="appt-main">
        <p className="strong">
          {doctorName(a.doctor)} <span className="muted">· {a.doctor.specialization}</span>
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
        {canCancel && (
          <Button size="sm" variant="ghost" busy={busy} onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>
    </li>
  );
}

export default function PatientAppointments() {
  const [tab, setTab] = useState('upcoming');
  const { data, error, loading, reload } = useApi(`/appointments?when=${tab}`);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Care"
        title="Appointments"
        subtitle="Request a visit; the doctor confirms it."
        actions={
          <Button icon="plus" onClick={() => setBooking(true)}>
            Book appointment
          </Button>
        }
      />
      {booked && <Alert tone="success">Appointment requested. You'll see it confirmed here once the doctor accepts.</Alert>}
      <Card
        flush
        actions={null}
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
        ) : data.appointments.length === 0 ? (
          <Empty icon="calendar" title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'} />
        ) : (
          <ul className="appts">
            {data.appointments.map((a) => (
              <AppointmentRow key={a.id} a={a} onChanged={reload} />
            ))}
          </ul>
        )}
      </Card>
      <Modal open={booking} onClose={() => setBooking(false)} title="Book an appointment" wide>
        <Booking
          onBooked={() => {
            setBooking(false);
            setBooked(true);
            setTab('upcoming');
            reload();
          }}
          onCancel={() => setBooking(false)}
        />
      </Modal>
    </>
  );
}
