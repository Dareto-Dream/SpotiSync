import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../modules/auth/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('jam_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const setSession = useCallback((data) => {
    if (!data?.token || !data?.user) return;
    localStorage.setItem('jam_token', data.token);
    localStorage.setItem('jam_user', JSON.stringify(data.user));
    setUser(data.user);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.post('/api/auth/login', { username, password });
    setSession(data);
    return data.user;
  }, [setSession]);

  const register = useCallback(async (username, password) => {
    const data = await api.post('/api/auth/register', { username, password });
    setSession(data);
    return data.user;
  }, [setSession]);

  const loginWithGoogle = useCallback(async (idToken) => {
    const data = await api.post('/api/auth/google', { idToken });
    setSession(data);
    return data.user;
  }, [setSession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (err) {
      console.warn('Logout failed', err);
    }
    api.clearAuth();
    setUser(null);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('jam_token')) {
      api.refresh().then(setSession).catch(() => {});
    }
  }, [setSession]);

  return (
    <AuthContext.Provider value={{ user, login, register, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
