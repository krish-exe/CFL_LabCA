import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth.jsx';
import { BrandMark, Icon } from './Icon.jsx';
import { initials } from './ui.jsx';

const NAV = {
  patient: [
    { to: '/dashboard', label: 'Overview', icon: 'home' },
    { to: '/appointments', label: 'Appointments', icon: 'calendar' },
    { to: '/records', label: 'My records', icon: 'file' },
    { to: '/sharing', label: 'Sharing', icon: 'share' },
    { to: '/activity', label: 'Access log', icon: 'activity' },
  ],
  doctor: [
    { to: '/schedule', label: 'Schedule', icon: 'calendar' },
    { to: '/patients', label: 'My patients', icon: 'users' },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: 'home', end: true },
    { to: '/admin/users', label: 'Accounts', icon: 'users' },
    { to: '/admin/audit', label: 'Audit log', icon: 'list' },
  ],
};

const ROLE_LABEL = { patient: 'Patient', doctor: 'Doctor', admin: 'Administrator' };

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const displayName = user.role === 'doctor' ? `Dr. ${user.fullName}` : user.fullName;

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <span className="brand">
          <BrandMark size={24} /> SecureClinic
        </span>
        <span className="avatar avatar-sm" aria-hidden="true">{initials(user.fullName)}</span>
      </header>

      <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-top">
          <span className="brand">
            <BrandMark size={28} /> SecureClinic
          </span>
          <button className="icon-btn sidebar-close" onClick={() => setOpen(false)} aria-label="Close menu">
            <Icon name="close" />
          </button>
        </div>
        <p className="sidebar-role">{ROLE_LABEL[user.role]} portal</p>
        <nav className="nav">
          {NAV[user.role].map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/security" className="nav-link">
            <Icon name="lock" />
            Security
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="whoami">
            <span className="avatar" aria-hidden="true">{initials(user.fullName)}</span>
            <div>
              <p className="whoami-name">{displayName}</p>
              <p className="whoami-meta">{user.email}</p>
            </div>
          </div>
          <p className={`session-chip ${user.totpEnabled ? 'on' : ''}`}>
            <Icon name="shield" size={14} />
            {user.totpEnabled ? 'Signed in with 2FA' : 'Password only: turn on 2FA'}
          </p>
          <button className="btn btn-ghost btn-block" onClick={logout}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
