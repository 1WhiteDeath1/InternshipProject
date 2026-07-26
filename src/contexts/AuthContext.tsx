import React, { useState, useEffect, useCallback } from 'react';
import api, { setMemoryToken } from '@/lib/api';
import { AuthContext, type User } from '@/contexts/auth-context';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Shared terminals, not personal devices: a fresh app load only restores
    // a session if the user ticked "Remember me" at login (persisted to
    // localStorage). Otherwise the token lived only in memory and is already
    // gone by the time this runs, so the app falls back to the Login page.
    const init = async () => {
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const res = await api.get('/auth/me');
          setUser(res.data);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  const login = useCallback(async (username: string, password: string, rememberMe: boolean) => {
    const res = await api.post('/auth/login', { username, password });
    const { access_token, user: userData } = res.data;
    if (rememberMe) {
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      setMemoryToken(access_token);
    }
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } catch { /* token is cleared client-side regardless */ }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setMemoryToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
