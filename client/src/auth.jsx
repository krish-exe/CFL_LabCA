import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onSessionChange, refreshSession, setAccessToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  useEffect(() => {
    onSessionChange({
      session: (user) => setState({ status: 'authed', user }),
      end: () => setState({ status: 'anon', user: null }),
    });
    // Restore the session from the HttpOnly refresh cookie, if there is one.
    refreshSession().then((user) => {
      if (!user) setState({ status: 'anon', user: null });
    });
  }, []);

  const completeLogin = useCallback((data) => {
    setAccessToken(data.accessToken);
    setState({ status: 'authed', user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', noRefresh: true }).catch(() => {});
    setAccessToken(null);
    setState({ status: 'anon', user: null });
  }, []);

  const value = useMemo(() => ({ ...state, completeLogin, logout }), [state, completeLogin, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const homeFor = (role) => ({ patient: '/dashboard', doctor: '/schedule', admin: '/admin' })[role] ?? '/login';
