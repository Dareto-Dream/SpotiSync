import React, { createContext, useContext, useState, useCallback } from 'react';
import { api } from '../modules/auth/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('jam_user');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const login = useCallback(async (username, password) => {
    const data = await api.post('/api/auth/login', { username, password });
    localStorage.setItem('jam_token', data.token);
    localStorage.setItem('jam_user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (username, password) => {
    await api.post('/api/auth/register', { username, password });
    return login(username, password);
  }, [login]);

  const logout = useCallback(() => {
    localStorage.removeItem('jam_token');
    localStorage.removeItem('jam_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
