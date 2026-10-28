// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ThemeProvider, THEME_STORAGE_KEY } from './theme'
import { useTheme } from './theme-context'
import userEvent from '@testing-library/user-event'
import { AppearanceControl } from '@/components/site/AppearanceControl'

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

test('one icon button cycles preferences, persists across remount, and returns to live System behavior', async () => {
  const user = userEvent.setup()
  system(true)
  const initial = render(<ThemeProvider><AppearanceControl /></ThemeProvider>)
  const control = screen.getByRole('button', { name: 'Appearance: System. Switch to Light' })
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(control.textContent).toBe('')
  expect(control.querySelector('svg.lucide-monitor')).not.toBeNull()
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.click(control)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.queryByRole('menu')).toBeNull()

  initial.unmount()
  render(<ThemeProvider><AppearanceControl /></ThemeProvider>)
  const restored = screen.getByRole('button', { name: 'Appearance: Light. Switch to Dark' })
  expect(restored.querySelector('svg.lucide-sun')).not.toBeNull()
  expect(document.documentElement.dataset.theme).toBe('light')
  await user.click(restored)
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  expect(screen.getByRole('button', { name: 'Appearance: Dark. Switch to System' }).querySelector('svg.lucide-moon')).not.toBeNull()
  await user.click(screen.getByRole('button'))
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  expect(document.documentElement.dataset.theme).toBe('dark')
  system(false)
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(screen.getByRole('button', { name: 'Appearance: System. Switch to Light' }).querySelector('svg.lucide-monitor')).not.toBeNull()
})

test('the appearance cycle uses native Enter and Space activation and retains keyboard focus', async () => {
  const user = userEvent.setup()
  render(<ThemeProvider><AppearanceControl /></ThemeProvider>)
  await user.tab()
  const control = screen.getByRole('button', { name: 'Appearance: System. Switch to Light' })
  expect(document.activeElement).toBe(control)
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Appearance: Light. Switch to Dark' })).toBe(control)
  expect(document.documentElement.dataset.theme).toBe('light')
  await user.keyboard(' ')
  expect(screen.getByRole('button', { name: 'Appearance: Dark. Switch to System' })).toBe(control)
  expect(document.documentElement.dataset.theme).toBe('dark')
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Appearance: System. Switch to Light' })).toBe(control)
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  expect(document.activeElement).toBe(control)
  expect(screen.queryByRole('radio')).toBeNull()
})
