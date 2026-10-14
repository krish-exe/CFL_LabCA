import { Fragment, useEffect, useState } from 'react';
import { api } from '../../api.js';
import AuditVerify from '../../components/AuditVerify.jsx';
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, formatDateTime } from '../../components/ui.jsx';

const OUTCOME_TONES = { success: 'ok', failure: 'warn', denied: 'danger' };
const ACTION_GROUPS = [
  { value: '', label: 'All actions' },
  { value: 'auth.', label: 'Sign-in & sessions' },
  { value: 'mfa.', label: 'Two-factor' },
  { value: 'record.', label: 'Record access' },
  { value: 'grant.', label: 'Sharing' },
  { value: 'appointment.', label: 'Appointments' },
  { value: 'admin.', label: 'Admin actions' },
  { value: 'authz.', label: 'Role denials' },
  { value: 'security.', label: 'Rate limiting' },
];

export default function AdminAudit() {
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState('');
  const [entries, setEntries] = useState([]);
  const [state, setState] = useState({ loading: true, error: null, more: false });
  const [open, setOpen] = useState(null);

  async function load(before) {
    setState((s) => ({ ...s, loading: true, error: null }));
    const params = new URLSearchParams({ limit: '50' });
    if (action) params.set('action', action);
    if (outcome) params.set('outcome', outcome);
    if (before) params.set('before', String(before));
    try {
      const data = await api(`/admin/audit?${params}`);
      setEntries((prev) => (before ? [...prev, ...data.entries] : data.entries));
      setState({ loading: false, error: null, more: data.entries.length === 50 });
    } catch (error) {
      setState({ loading: false, error, more: false });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, outcome]);

  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log" subtitle="Append-only and hash-chained. Select an entry to see its details and hashes." />
      <Card title="Integrity">
        <AuditVerify />
      </Card>
      <Card flush>
        <div className="toolbar">
          <select className="input" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action type">
            {ACTION_GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <option value="">Any outcome</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </select>
          <Button variant="ghost" onClick={() => load()}>
            Refresh
          </Button>
        </div>
        {state.error && <Alert tone="danger">{state.error.message}</Alert>}
        {entries.length === 0 && !state.loading ? (
          <Empty icon="list" title="No entries match" />
        ) : (
          <div className="table-wrap">
            <table className="table table-audit">
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Result</th>
                  <th>Target</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className={`clickable ${open === e.id ? 'open' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="mono muted">{e.id}</td>
                      <td className="nowrap">{formatDateTime(e.at)}</td>
                      <td>
                        {e.actor ? (
                          <>
                            <span className="block">{e.actor.fullName ?? 'Unknown'}</span>
                            <span className="muted small capitalize">{e.actor.role}</span>
                          </>
                        ) : (
                          <span className="muted">anonymous / system</span>
                        )}
                      </td>
                      <td className="mono small">{e.action}</td>
                      <td>
                        <Badge tone={OUTCOME_TONES[e.outcome]}>{e.outcome}</Badge>
                      </td>
                      <td className="small">{e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ''}` : '—'}</td>
                      <td className="mono small nowrap">{e.ip ?? '—'}</td>
                    </tr>
                    {open === e.id && (
                      <tr className="detail-row">
                        <td colSpan={7}>
                          <dl className="facts facts-compact">
                            <div>
                              <dt>Details</dt>
                              <dd className="mono small">{JSON.stringify(e.details)}</dd>
                            </div>
                            <div>
                              <dt>Target id</dt>
                              <dd className="mono small">{e.targetId ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>User agent</dt>
                              <dd className="small">{e.userAgent ?? '—'}</dd>
                            </div>
                            <div>
                              <dt>Previous hash</dt>
                              <dd className="mono small break">{e.prevHash}</dd>
                            </div>
                            <div>
                              <dt>Entry hash</dt>
                              <dd className="mono small break">{e.hash}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state.loading && <Loading />}
        {state.more && !state.loading && (
          <div className="load-more">
            <Button variant="secondary" onClick={() => load(entries.at(-1).id)}>
              Load older entries
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
