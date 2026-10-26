// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ThemeProvider, THEME_STORAGE_KEY } from './theme'
import { useTheme } from './theme-context'

let dark = false
const listeners = new Set<() => void>()
function Probe() {
  const { theme, preference, setPreference } = useTheme()
  return <><output data-testid="theme">{preference}:{theme}</output>{(['system', 'light', 'dark'] as const).map(value => <button key={value} onClick={() => setPreference(value)}>{value}</button>)}</>
}
function system(value: boolean) { dark = value; act(() => listeners.forEach(listener => listener())) }
beforeEach(() => {
  localStorage.clear(); dark = false; listeners.clear()
  vi.stubGlobal('matchMedia', () => ({ get matches() { return dark }, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); document.documentElement.classList.remove('dark') })
test('missing preference stays System instead of freezing the first OS value into storage', () => {
  render(<ThemeProvider><Probe /></ThemeProvider>)
  expect(screen.getByTestId('theme').textContent).toBe('system:light')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  system(true)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(screen.getByTestId('theme').textContent).toBe('system:dark')
})
test('explicit choices persist and ignore OS changes until System is selected', () => {
  localStorage.setItem(THEME_STORAGE_KEY, 'dark');render(<ThemeProvider><Probe /></ThemeProvider>)
  expect(document.documentElement.dataset.theme).toBe('dark')
  fireEvent.click(screen.getByText('light'));system(true)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  fireEvent.click(screen.getByText('system'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
})
test('other tabs and clear storage update preference without writing it back', () => {
  render(<ThemeProvider><Probe /></ThemeProvider>)
  act(() => { localStorage.setItem(THEME_STORAGE_KEY, 'dark');window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY })) })
  expect(screen.getByTestId('theme').textContent).toBe('dark:dark')
  act(() => {localStorage.clear();window.dispatchEvent(new StorageEvent('storage', { key: null }))})
  expect(screen.getByTestId('theme').textContent).toBe('system:light')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
})
test('invalid or denied storage remains usable and subscriptions clean up', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw new Error('denied')})
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new Error('denied')})
  const result=render(<ThemeProvider><Probe /></ThemeProvider>)
  expect(screen.getByTestId('theme').textContent).toBe('system:light')
  fireEvent.click(screen.getByText('dark'))
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(listeners.size).toBe(1);result.unmount();expect(listeners.size).toBe(0)
})
