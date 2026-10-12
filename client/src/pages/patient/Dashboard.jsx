import { Link } from 'react-router';
import { useAuth } from '../../auth.jsx';
import { Icon } from '../../components/Icon.jsx';
import { Badge, Card, Countdown, Empty, Loading, PageHeader, RECORD_TYPE_LABELS, STATUS_TONES, doctorName, formatDate, formatDateTime, formatDay, formatRelative, useApi } from '../../components/ui.jsx';
import { describeAction } from './AccessLog.jsx';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function PatientDashboard() {
  const { user } = useAuth();
  const appts = useApi('/appointments?when=upcoming');
  const grants = useApi('/grants');
  const records = useApi('/records');
  const log = useApi('/me/access-log');

  const next = appts.data?.appointments.find((a) => a.status !== 'cancelled');
  const active = grants.data?.grants.filter((g) => g.status === 'active') ?? [];
  const othersAccess = log.data?.entries.filter((e) => !e.actor.self).slice(0, 5) ?? [];

  return (
    <>
      <PageHeader eyebrow={formatDay(new Date())} title={`${greeting()}, ${user.fullName.split(' ')[0]}`} subtitle="Here's what's happening with your care." />
      <div className="grid-cards">
        <Card title="Next appointment" actions={<Link className="link" to="/appointments">All appointments</Link>}>
          {appts.loading ? (
            <Loading />
          ) : next ? (
            <div className="next-appt">
              <p className="next-when">{formatDateTime(next.scheduledAt)}</p>
              <p className="strong">
                {doctorName(next.doctor)} <span className="muted">· {next.doctor.specialization}</span>
              </p>
              <p className="muted">{next.reason}</p>
              <Badge tone={STATUS_TONES[next.status]}>{next.status}</Badge>
            </div>
          ) : (
            <Empty icon="calendar" title="Nothing booked">
              <Link className="btn btn-primary btn-sm" to="/appointments">Book an appointment</Link>
            </Empty>
          )}
        </Card>

        <Card title="Who can see your records" actions={<Link className="link" to="/sharing">Manage</Link>}>
          {grants.loading ? (
            <Loading />
          ) : active.length ? (
            <ul className="list">
              {active.map((g) => (
                <li key={g.id} className="list-row">
                  <Icon name="stethoscope" size={20} className="list-icon" />
                  <div className="list-main">
                    <p className="strong">{doctorName(g.doctor)}</p>
                    <p className="muted small">{g.scope === 'read_write' ? 'Can view and add' : 'Can view'}</p>
                  </div>
                  <Countdown until={g.expiresAt} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="lock" title="Only you">
              No doctor can see your records right now.
            </Empty>
          )}
        </Card>

        <Card title="Recent records" actions={<Link className="link" to="/records">All records</Link>}>
          {records.loading ? (
            <Loading />
          ) : records.data?.records.length ? (
            <ul className="list">
              {records.data.records.slice(0, 4).map((r) => (
                <li key={r.id} className="list-row">
                  <Icon name="file" size={20} className="list-icon" />
                  <div className="list-main">
                    <p className="strong">{r.title}</p>
                    <p className="muted small">
                      {RECORD_TYPE_LABELS[r.type]} · {formatDate(r.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No records yet" />
          )}
        </Card>

        <Card title="Recent access by others" actions={<Link className="link" to="/activity">Full log</Link>}>
          {log.loading ? (
            <Loading />
          ) : othersAccess.length ? (
            <ul className="list">
              {othersAccess.map((e) => (
                <li key={e.id} className="list-row">
                  <Icon name={e.outcome === 'denied' ? 'alert' : 'eye'} size={20} className={`list-icon ${e.outcome === 'denied' ? 'tone-danger' : ''}`} />
                  <div className="list-main">
                    <p className="strong">{e.actor.role === 'doctor' ? doctorName(e.actor) : e.actor.fullName}</p>
                    <p className="muted small">{describeAction(e)}</p>
                  </div>
                  <span className="muted small nowrap">{formatRelative(e.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon="activity" title="No one else has opened your file" />
          )}
        </Card>
      </div>
    </>
  );
}
