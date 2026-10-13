import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../auth.jsx';
import { RecordForm, RecordList } from '../../components/Records.jsx';
import { Alert, Button, Card, Countdown, Empty, Loading, Modal, PageHeader, ageFrom, useApi } from '../../components/ui.jsx';

export default function PatientFile() {
  const { patientId } = useParams();
  const { user } = useAuth();
  const grants = useApi('/grants');
  const records = useApi(`/records?patientId=${encodeURIComponent(patientId)}`);
  const [adding, setAdding] = useState(false);

  const grant = grants.data?.grants.find((g) => g.patient.id === patientId);

  if (grants.loading || (records.loading && !records.data)) return <Loading />;

  if (!grant || records.error) {
    return (
      <>
        <PageHeader eyebrow="Patient file" title="No access" />
        <Card>
          <Empty icon="lock" title="This file isn't shared with you">
            {records.error?.message ?? 'The patient has not granted access, or the grant has expired or been revoked.'}
            <p>
              <Link className="link" to="/patients">Back to my patients</Link>
            </p>
          </Empty>
        </Card>
      </>
    );
  }

  const age = ageFrom(grant.patient.dateOfBirth);
  const canWrite = grant.scope === 'read_write';

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/patients" className="link">← My patients</Link>}
        title={grant.patient.fullName}
        subtitle={
          <>
            {age !== null && `${age} years · `}
            {canWrite ? 'You can view and add records' : 'View-only access'} · <Countdown until={grant.expiresAt} />
          </>
        }
        actions={
          canWrite && (
            <Button icon="plus" onClick={() => setAdding(true)}>
              Add record
            </Button>
          )
        }
      />
      <Alert tone="info">Every time you open this file it is recorded in the audit log, and the patient can see it.</Alert>
      <Card>
        {records.error ? (
          <Alert tone="danger">{records.error.message}</Alert>
        ) : (
          <RecordList records={records.data.records} currentUserId={user.id} onDeleted={records.reload} emptyText="This patient has no records yet." />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={`Add to ${grant.patient.fullName}'s file`}>
        <RecordForm
          role="doctor"
          patientId={patientId}
          onCreated={() => {
            setAdding(false);
            records.reload();
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>
    </>
  );
}
