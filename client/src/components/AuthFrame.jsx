import { BrandMark, Icon } from './Icon.jsx';

const POINTS = [
  { icon: 'lock', text: 'Diagnoses, notes and reports are encrypted with AES-256 before they are stored.' },
  { icon: 'share', text: 'You decide which doctor sees your records, and for how long.' },
  { icon: 'activity', text: 'Every access to your file is logged, and you can see who looked.' },
];

/** Two-column frame for sign-in, registration and first-login steps. */
export default function AuthFrame({ title, subtitle, children, footer }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <span className="brand brand-light">
          <BrandMark size={30} /> SecureClinic
        </span>
        <div className="auth-pitch">
          <h2>Your health records, shared on your terms.</h2>
          <ul>
            {POINTS.map((p) => (
              <li key={p.icon}>
                <Icon name={p.icon} size={18} />
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="auth-aside-foot">Privacy-preserving appointment & health records portal</p>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <span className="brand auth-brand-mobile">
            <BrandMark size={26} /> SecureClinic
          </span>
          <h1>{title}</h1>
          {subtitle && <p className="auth-subtitle">{subtitle}</p>}
          {children}
          {footer && <div className="auth-footer">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
