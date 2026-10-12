// Record list, file download/preview and the add-record form, shared by patients and doctors.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';
import { Alert, Badge, Button, Empty, Field, Modal, RECORD_TYPE_LABELS, formatBytes, formatDate, doctorName } from './ui.jsx';

const TYPE_TONES = { prescription: 'accent', lab_report: 'info', diagnosis: 'warn', imaging: 'info', note: 'neutral', other: 'neutral' };

async function fetchFile(record) {
  return api(`/records/${record.id}/file`, { blob: true });
}

function FileRow({ record }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const isImage = record.file.mime.startsWith('image/');

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const url = URL.createObjectURL(await fetchFile(record));
      const a = document.createElement('a');
      a.href = url;
      a.download = record.file.name || 'record';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function show() {
    setBusy(true);
    try {
      setPreview(URL.createObjectURL(await fetchFile(record)));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="file-row">
      <Icon name="lock" size={16} className="file-lock" title="Encrypted at rest" />
      <span className="file-name">{record.file.name}</span>
      <span className="muted small">{formatBytes(record.file.size)}</span>
      <span className="file-actions">
        {isImage && (
          <Button size="sm" variant="ghost" icon="eye" onClick={show} disabled={busy}>
            View
          </Button>
        )}
        <Button size="sm" variant="ghost" icon="download" onClick={download} busy={busy}>
          Download
        </Button>
      </span>
      {error && <span className="field-error">{error}</span>}
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={record.file.name} wide>
        {preview && <img src={preview} alt={record.title} className="preview-img" />}
      </Modal>
    </div>
  );
}

export function RecordList({ records, currentUserId, onDeleted, emptyText }) {
  const [filter, setFilter] = useState('all');
  const [deleting, setDeleting] = useState(null);
  const types = [...new Set(records.map((r) => r.type))];
  const shown = filter === 'all' ? records : records.filter((r) => r.type === filter);

  async function remove(record) {
    if (!window.confirm(`Delete "${record.title}"? This can't be undone.`)) return;
    setDeleting(record.id);
    try {
      await api(`/records/${record.id}`, { method: 'DELETE' });
      onDeleted?.();
    } finally {
      setDeleting(null);
    }
  }

  if (records.length === 0) return <Empty title="No records yet">{emptyText}</Empty>;

  return (
    <div className="stack">
      {types.length > 1 && (
        <div className="chips" role="group" aria-label="Filter by type">
          {['all', ...types].map((t) => (
            <button key={t} className={`chip ${filter === t ? 'active' : ''}`} onClick={() => setFilter(t)}>
              {t === 'all' ? `All (${records.length})` : RECORD_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      <ul className="records">
        {shown.map((r) => (
          <li key={r.id} className="record">
            <div className="record-head">
              <Badge tone={TYPE_TONES[r.type]}>{RECORD_TYPE_LABELS[r.type]}</Badge>
              <span className="muted small">{formatDate(r.createdAt)}</span>
            </div>
            <h3 className="record-title">{r.title}</h3>
            {r.diagnosis && (
              <p className="record-diagnosis">
                <span>Diagnosis</span> {r.diagnosis}
              </p>
            )}
            {r.description && <p className="record-desc">{r.description}</p>}
            {r.file && <FileRow record={r} />}
            <div className="record-foot">
              <span className="muted small">
                Added by {r.createdBy.id === currentUserId ? 'you' : r.createdBy.role === 'doctor' ? doctorName(r.createdBy) : r.createdBy.fullName}
              </span>
              {r.createdBy.id === currentUserId && (
                <Button size="sm" variant="ghost" icon="trash" busy={deleting === r.id} onClick={() => remove(r)}>
                  Delete
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PATIENT_TYPES = ['lab_report', 'imaging', 'prescription', 'other'];
const DOCTOR_TYPES = ['prescription', 'diagnosis', 'note', 'lab_report', 'imaging', 'other'];

export function RecordForm({ role, patientId, onCreated, onCancel }) {
  const types = role === 'doctor' ? DOCTOR_TYPES : PATIENT_TYPES;
  const [form, setForm] = useState({ type: types[0], title: '', description: '', diagnosis: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const needsFile = form.type === 'lab_report' || form.type === 'imaging';
  const fields = error?.fields ?? {};

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData();
    data.append('type', form.type);
    data.append('title', form.title);
    if (form.description) data.append('description', form.description);
    if (role === 'doctor' && form.diagnosis) data.append('diagnosis', form.diagnosis);
    if (patientId) data.append('patientId', patientId);
    if (file) data.append('file', file);
    try {
      await api('/records', { method: 'POST', form: data });
      onCreated();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <Alert tone="danger">{error.message}</Alert>}
      <div className="grid-2">
        <Field label="Type" htmlFor="r-type">
          <select id="r-type" className="input" value={form.type} onChange={set('type')}>
            {types.map((t) => (
              <option key={t} value={t}>
                {RECORD_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title" htmlFor="r-title" error={fields.title}>
          <input id="r-title" className="input" value={form.title} onChange={set('title')} required minLength={2} maxLength={150} placeholder="e.g. Thyroid panel" />
        </Field>
      </div>
      {role === 'doctor' && (form.type === 'diagnosis' || form.type === 'note') && (
        <Field label="Diagnosis" htmlFor="r-diag" error={fields.diagnosis}>
          <input id="r-diag" className="input" value={form.diagnosis} onChange={set('diagnosis')} maxLength={2000} placeholder="e.g. Iron-deficiency anaemia (D50.9)" />
        </Field>
      )}
      <Field label={role === 'doctor' && form.type === 'prescription' ? 'Medication & instructions' : 'Description'} htmlFor="r-desc" error={fields.description}>
        <textarea id="r-desc" className="input" rows={4} value={form.description} onChange={set('description')} maxLength={4000} />
      </Field>
      <Field
        label={needsFile ? 'Report file' : 'Attachment (optional)'}
        htmlFor="r-file"
        hint="PDF, PNG, JPEG or WebP, up to 5 MB. The file is checked by its contents and encrypted with its own AES-256 key."
      >
        <input id="r-file" className="input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files[0] ?? null)} required={needsFile} />
      </Field>
      <div className="row">
        <Button type="submit" busy={busy} icon="upload">
          Save record
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
