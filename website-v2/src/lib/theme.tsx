import * as React from 'react'
import { ThemeContext, type Theme } from './theme-context'

// SSR-safe initial theme. localStorage + window.matchMedia don't exist
// during prerender. We default to 'dark' on the server (matches the
// inline <script> in index.html that sets data-theme before paint).
// On the client, the useEffect below reconciles immediately from the
// real localStorage value, so this default is short-lived.
function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage?.getItem('pd-theme') as Theme | null
  if (stored) return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>(initialTheme)

  React.useEffect(() => {
    // Set data-theme for CSS variables
    document.documentElement.setAttribute('data-theme', theme)
    
    // Set .dark class for Tailwind v4 compatibility
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    
    localStorage.setItem('pd-theme', theme)
  }, [theme])

  const toggle = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {/*
        suppressHydrationWarning: the server prerenders className="dark"
        (initialTheme()'s SSR fallback). On the client, initialTheme()
        re-runs in the useState initializer and may pick 'light' from
        localStorage — same logic as the inline <script> in index.html.
        React 19 would otherwise flag this as a hydration mismatch, which
        is exactly what suppressHydrationWarning is for: server-rendered
        theme guess vs. real client preference.
      */}
      <div className={theme} suppressHydrationWarning>
        {children}
      </div>
    </ThemeContext.Provider>
  )
}
