import * as React from 'react'

export type Theme = 'dark' | 'light'
export type ThemePreference = Theme | 'system'

export const ThemeContext = React.createContext<{
  theme: Theme
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  toggle: () => void
}>({ theme: 'dark', preference: 'system', setPreference: () => {}, toggle: () => {} })

export function useTheme() {
  return React.useContext(ThemeContext)
}
