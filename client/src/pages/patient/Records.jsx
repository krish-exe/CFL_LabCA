import { useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { RecordForm, RecordList } from '../../components/Records.jsx';
import { Alert, Button, Card, Loading, Modal, PageHeader, useApi } from '../../components/ui.jsx';

export default function PatientRecords() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi('/records');
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        eyebrow="Health records"
        title="My records"
        subtitle="Prescriptions, lab reports and notes from your doctors. Everything here is encrypted at rest."
        actions={
          <Button icon="upload" onClick={() => setAdding(true)}>
            Upload a report
          </Button>
        }
      />
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <Alert tone="danger">{error.message}</Alert>
        ) : (
          <RecordList records={data.records} currentUserId={user.id} onDeleted={reload} emptyText="Upload a lab report, or ask your doctor to add a prescription." />
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Upload a report">
        <RecordForm
          role="patient"
          onCreated={() => {
            setAdding(false);
            reload();
          }}
          onCancel={() => setAdding(false)}
        />
      </Modal>
    </>
  );
}
