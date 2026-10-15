import { Navigate } from 'react-router';
import { homeFor, useAuth } from '../auth.jsx';
import AuthFrame from '../components/AuthFrame.jsx';
import ChangePasswordForm from '../components/ChangePasswordForm.jsx';
import { Button } from '../components/ui.jsx';

/** First sign-in with an admin-issued temporary password: it must be replaced before anything else. */
export default function ForcedPasswordChange() {
  const { user, completeLogin, logout } = useAuth();
  if (!user.mustChangePassword) return <Navigate to={homeFor(user.role)} replace />;
  return (
    <AuthFrame
      title="Choose your own password"
      subtitle="Your account was created with a temporary password. Replace it to continue."
      footer={<Button variant="ghost" onClick={logout}>Sign out</Button>}
    >
      <ChangePasswordForm email={user.email} currentLabel="Temporary password" onChanged={completeLogin} />
    </AuthFrame>
  );
}
