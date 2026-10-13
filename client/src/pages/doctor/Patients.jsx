import { Link } from 'react-router';
import { Alert, Badge, Card, Countdown, Empty, Loading, PageHeader, ageFrom, initials, useApi } from '../../components/ui.jsx';

export default function Patients() {
  const { data, error, loading } = useApi('/grants');
  return (
    <>
      <PageHeader
        eyebrow="Clinic"
        title="My patients"
        subtitle="Patients who have shared their records with you. Each file closes automatically when the patient's grant expires."
      />
      <Card flush>
        {loading ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : data.grants.length === 0 ? (
          <Empty icon="users" title="No shared files">
            Patients share access from their Sharing page.
          </Empty>
        ) : (
          <ul className="patient-list">
            {data.grants.map((g) => {
              const age = ageFrom(g.patient.dateOfBirth);
              return (
                <li key={g.id}>
                  <Link to={`/patients/${g.patient.id}`} className="patient-row">
                    <span className="avatar">{initials(g.patient.fullName)}</span>
                    <span className="list-main">
                      <span className="strong block">{g.patient.fullName}</span>
                      <span className="muted small">
                        {age !== null ? `${age} yrs · ` : ''}
                        {g.patient.email}
                      </span>
                    </span>
                    <Badge tone={g.scope === 'read_write' ? 'accent' : 'neutral'}>{g.scope === 'read_write' ? 'View & add' : 'View only'}</Badge>
                    <Countdown until={g.expiresAt} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
