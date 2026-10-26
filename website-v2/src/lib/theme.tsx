import * as React from 'react'
import { ThemeContext, type Theme, type ThemePreference } from './theme-context'

export const THEME_STORAGE_KEY = 'pd-theme'
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}
function readPreference(): ThemePreference {
  try { return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)) }
  catch { return 'system' }
}
function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, updatePreference] = React.useState<ThemePreference>(() => typeof window === 'undefined' ? 'system' : readPreference())
  const [system, setSystem] = React.useState<Theme>(systemTheme)
  const theme = preference === 'system' ? system : preference

  React.useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => setSystem(query.matches ? 'dark' : 'light')
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) updatePreference(readPreference())
    }
    onSystemChange()
    query.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    return () => {
      query.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  React.useEffect(() => { applyTheme(theme) }, [theme])

  const setPreference = React.useCallback((value: ThemePreference) => {
    const next = parseThemePreference(value)
    updatePreference(next)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* Keep the current tab usable without storage. */ }
  }, [])
  const toggle = React.useCallback(() => setPreference(theme === 'dark' ? 'light' : 'dark'), [setPreference, theme])

  return <ThemeContext.Provider value={{ theme, preference, setPreference, toggle }}><div className={theme}>{children}</div></ThemeContext.Provider>
}
