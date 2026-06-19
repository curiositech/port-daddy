import * as React from 'react'

export type Theme = 'dark' | 'light'

export const ThemeContext = React.createContext<{
  theme: Theme
  toggle: () => void
}>({ theme: 'dark', toggle: () => {} })

export function useTheme() {
  return React.useContext(ThemeContext)
}
