import { Link } from 'react-router';
import AuditVerify from '../../components/AuditVerify.jsx';
import { Alert, Card, Loading, PageHeader, useApi } from '../../components/ui.jsx';

function Stat({ label, value, tone }) {
  return (
    <div className={`stat ${tone && value > 0 ? `stat-${tone}` : ''}`}>
      <span className="stat-value">{value ?? 0}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function AdminOverview() {
  const { data, error, loading } = useApi('/admin/stats');
  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Overview"
        subtitle="Accounts and security events. Administrators manage access but cannot open patients' clinical records."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <Alert tone="danger">{error.message}</Alert>
      ) : (
        <div className="stack-lg">
          <Card title="Clinic">
            <div className="stats">
              <Stat label="Patients" value={data.users.patient} />
              <Stat label="Doctors" value={data.users.doctor} />
              <Stat label="Admins" value={data.users.admin} />
              <Stat label="Upcoming appointments" value={data.upcomingAppointments} />
              <Stat label="Records" value={data.records} />
              <Stat label="Encrypted files" value={data.encryptedFiles} />
            </div>
          </Card>
          <Card title="Security, last 24 hours" actions={<Link className="link" to="/admin/audit">Open audit log</Link>}>
            <div className="stats">
              <Stat label="Failed sign-ins" value={data.last24h.failed_logins} tone="warn" />
              <Stat label="Account lockouts" value={data.last24h.lockouts} tone="danger" />
              <Stat label="Currently locked" value={data.lockedAccounts} tone="danger" />
              <Stat label="Blocked requests" value={data.last24h.denied} tone="warn" />
              <Stat label="Rate-limited" value={data.last24h.rate_limited} tone="warn" />
              <Stat label="Stolen-token alerts" value={data.last24h.token_reuse} tone="danger" />
            </div>
          </Card>
          <Card title="Audit log integrity">
            <AuditVerify />
          </Card>
        </div>
      )}
    </>
  );
}
