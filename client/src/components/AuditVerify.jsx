import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Button } from './ui.jsx';

/** Re-computes the audit log's HMAC hash chain on the server and shows the result. */
export default function AuditVerify() {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/admin/audit/verify'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted">
        Each entry stores an HMAC-SHA256 of its contents plus the previous entry's hash. Editing, deleting or reordering any
        entry breaks every link after it.
      </p>
      {error && <Alert tone="danger">{error.message}</Alert>}
      {result &&
        (result.ok ? (
          <Alert tone="success" title={`Intact: all ${result.checked.toLocaleString('en-IN')} entries verified`}>
            <span className="mono small">head {result.headHash.slice(0, 24)}…</span>
          </Alert>
        ) : (
          <Alert tone="danger" title={`Tampering detected at entry #${result.brokenAtId}`}>
            {result.reason} {result.checked.toLocaleString('en-IN')} entries before it verified.
          </Alert>
        ))}
      <div>
        <Button icon="shield" variant="secondary" busy={busy} onClick={verify}>
          Verify integrity
        </Button>
      </div>
    </div>
  );
}
