import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icon.jsx';

export function Button({ variant = 'primary', size, busy = false, icon, children, className = '', ...props }) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${className}`}
      disabled={busy || props.disabled}
      aria-busy={busy || undefined}
      type={props.type ?? 'button'}
      {...props}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, htmlFor }) {
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <p className="field-error">{error}</p> : hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className = '', flush = false }) {
  return (
    <section className={`card ${flush ? 'card-flush' : ''} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export const Badge = ({ tone = 'neutral', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export function Alert({ tone = 'info', title, children }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'check' : tone === 'danger' || tone === 'warn' ? 'alert' : 'shield'} size={18} />
      <div>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon = 'file', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export const Loading = ({ label = 'Loading' }) => (
  <div className="loading" role="status">
    <span className="spinner" aria-hidden="true" /> {label}…
  </div>
);

export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Modal({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <header className="modal-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/** Live "time left" label for grant and session expiry. */
export function Countdown({ until }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(until) - now;
  if (ms <= 0) return <span className="countdown expired">expired</span>;
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  const text = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(m, 1)}m`;
  return <span className={`countdown ${mins < 60 ? 'soon' : ''}`}>{text} left</span>;
}

/** Fetches a GET endpoint and exposes { data, error, loading, reload }. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ data: await api(path), error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load };
}

// ---- Formatting ----
const dtf = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' });
const dayf = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

export const formatDateTime = (v) => (v ? dtf.format(new Date(v)) : '—');
export const formatDate = (v) => (v ? df.format(new Date(v)) : '—');
export const formatTime = (v) => (v ? tf.format(new Date(v)) : '—');
export const formatDay = (v) => (v ? dayf.format(new Date(v)) : '—');

export function formatRelative(v) {
  const diff = (Date.now() - new Date(v)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return formatDate(v);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ageFrom(dob) {
  if (!dob) return null;
  const b = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age;
}

export const RECORD_TYPE_LABELS = {
  prescription: 'Prescription',
  lab_report: 'Lab report',
  diagnosis: 'Diagnosis',
  imaging: 'Imaging',
  note: 'Clinical note',
  other: 'Other',
};

export const STATUS_TONES = { requested: 'warn', confirmed: 'accent', completed: 'neutral', cancelled: 'danger' };

export const doctorName = (d) => (d?.fullName ? `Dr. ${d.fullName}` : 'Doctor');

/** Initials for avatar circles. */
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
