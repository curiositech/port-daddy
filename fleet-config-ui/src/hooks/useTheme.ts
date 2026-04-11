import { useState, useEffect } from 'react';

export type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void] {
  const queryTheme = (() => {
    try {
      const value = new URLSearchParams(window.location.search).get('theme');
      return value === 'dark' || value === 'light' ? value : null;
    } catch {
      return null;
    }
  })();

  const [theme, setTheme] = useState<Theme>(() => {
    return queryTheme || (localStorage.getItem('pd-theme') as Theme) || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pd-theme', theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return [theme, toggle];
}
