import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

const THEMES = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'ember', label: 'Ember' },
  { id: 'mint', label: 'Mint' },
  { id: 'paper', label: 'Paper' },
];

const ThemeContext = createContext({
  theme: 'midnight',
  themes: THEMES,
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  const { user } = useAuth();
  const userKey = user?.id ? `jam_theme_${user.id}` : 'jam_theme_guest';
  const [theme, setThemeState] = useState('midnight');

  useEffect(() => {
    const stored = localStorage.getItem(userKey);
    const next = THEMES.some(t => t.id === stored) ? stored : 'midnight';
    setThemeState(next);
  }, [userKey]);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(userKey, theme);
  }, [theme, userKey]);

  const setTheme = useCallback((next) => {
    if (THEMES.some(t => t.id === next)) {
      setThemeState(next);
    }
  }, []);

  const value = useMemo(() => ({ theme, themes: THEMES, setTheme }), [theme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
