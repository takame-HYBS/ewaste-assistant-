import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);

  const finish = ({ token, user }) => { setToken(token); setUser(user); return user; };
  const value = {
    user, ready,
    login: async (email, password) => finish(await api.post('/auth/login', { email, password })),
    // Returns { verificationRequired, email, demoCode? } when an emailed code must be entered, otherwise the new user.
    register: async (data) => {
      const r = await api.post('/auth/register', data);
      return r.verificationRequired ? r : finish(r);
    },
    verifyEmail: async (email, code) => finish(await api.post('/auth/verify-email', { email, code })),
    resendCode: (email) => api.post('/auth/resend-code', { email }),
    logout: () => { setToken(null); setUser(null); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
