import { Navigate, Route, Routes, useLocation } from 'react-router';
import { homeFor, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForcedPasswordChange from './pages/ForcedPasswordChange.jsx';
import Security from './pages/Security.jsx';
import PatientDashboard from './pages/patient/Dashboard.jsx';
import PatientAppointments from './pages/patient/Appointments.jsx';
import PatientRecords from './pages/patient/Records.jsx';
import Sharing from './pages/patient/Sharing.jsx';
import AccessLog from './pages/patient/AccessLog.jsx';
import Schedule from './pages/doctor/Schedule.jsx';
import Patients from './pages/doctor/Patients.jsx';
import PatientFile from './pages/doctor/PatientFile.jsx';
import AdminOverview from './pages/admin/Overview.jsx';
import AdminUsers from './pages/admin/Users.jsx';
import AdminAudit from './pages/admin/Audit.jsx';

/** Route guard: signed in, temporary password replaced, and (optionally) one of the given roles. */
function Protected({ roles, children }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Loading label="Restoring your session" />;
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function PublicOnly({ children }) {
  const { status, user } = useAuth();
  if (status === 'loading') return <Loading label="Restoring your session" />;
  if (status === 'authed') return <Navigate to={user.mustChangePassword ? '/change-password' : homeFor(user.role)} replace />;
  return children;
}

export default function App() {
  const { status, user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route
        path="/change-password"
        element={status === 'authed' ? <ForcedPasswordChange /> : status === 'loading' ? <Loading /> : <Navigate to="/login" replace />}
      />

      <Route element={<Protected><Layout /></Protected>}>
        <Route path="/security" element={<Security />} />

        <Route path="/dashboard" element={<Protected roles={['patient']}><PatientDashboard /></Protected>} />
        <Route path="/appointments" element={<Protected roles={['patient']}><PatientAppointments /></Protected>} />
        <Route path="/records" element={<Protected roles={['patient']}><PatientRecords /></Protected>} />
        <Route path="/sharing" element={<Protected roles={['patient']}><Sharing /></Protected>} />
        <Route path="/activity" element={<Protected roles={['patient']}><AccessLog /></Protected>} />

        <Route path="/schedule" element={<Protected roles={['doctor']}><Schedule /></Protected>} />
        <Route path="/patients" element={<Protected roles={['doctor']}><Patients /></Protected>} />
        <Route path="/patients/:patientId" element={<Protected roles={['doctor']}><PatientFile /></Protected>} />

        <Route path="/admin" element={<Protected roles={['admin']}><AdminOverview /></Protected>} />
        <Route path="/admin/users" element={<Protected roles={['admin']}><AdminUsers /></Protected>} />
        <Route path="/admin/audit" element={<Protected roles={['admin']}><AdminAudit /></Protected>} />
      </Route>

      <Route path="*" element={<Navigate to={status === 'authed' ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
  );
}
