import { useState } from 'react';
import { Badge, Card, Empty, Loading, PageHeader, Alert, doctorName, formatDateTime, useApi } from '../../components/ui.jsx';

const ACTIONS = {
  'record.list': 'Opened your records',
  'record.view': 'Viewed a record',
  'record.download': 'Downloaded a file',
  'record.create': 'Added a record',
  'record.delete': 'Deleted a record',
  'record.access': 'Tried to open a record',
  'grant.create': 'Shared access with a doctor',
  'grant.revoke': 'Revoked a doctor’s access',
  'appointment.create': 'Booked an appointment',
  'appointment.update': 'Updated an appointment',
};

export const describeAction = (e) => `${ACTIONS[e.action] ?? e.action}${e.outcome === 'denied' ? ' (blocked)' : ''}`;

export default function AccessLog() {
  const { data, error, loading } = useApi('/me/access-log');
  const [showOwn, setShowOwn] = useState(false);
  const entries = (data?.entries ?? []).filter((e) => showOwn || !e.actor.self);
  return (
    <>
      <PageHeader
        eyebrow="Transparency"
        title="Access log"
        subtitle="Every time anyone opens, adds to or tries to reach your file, it's written to a tamper-evident log. Here is your part of it."
      />
      <Card
        flush
        title={showOwn ? 'All activity' : 'Activity by other people'}
        actions={
          <label className="toggle">
            <input type="checkbox" checked={showOwn} onChange={(e) => setShowOwn(e.target.checked)} /> Include my own activity
          </label>
        }
      >
        {loading ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : entries.length === 0 ? (
          <Empty icon="activity" title={showOwn ? 'No activity yet' : 'No one else has opened or tried to open your file'} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className={e.outcome === 'denied' ? 'row-danger' : ''}>
                    <td className="nowrap">{formatDateTime(e.at)}</td>
                    <td>
                      {e.actor.self ? 'You' : e.actor.role === 'doctor' ? doctorName(e.actor) : e.actor.fullName}
                      {!e.actor.self && <span className="muted small capitalize"> · {e.actor.role}</span>}
                    </td>
                    <td>{describeAction(e)}</td>
                    <td>
                      <Badge tone={e.outcome === 'success' ? 'ok' : 'danger'}>{e.outcome === 'success' ? 'Allowed' : 'Blocked'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
