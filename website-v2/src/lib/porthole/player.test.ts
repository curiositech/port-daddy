// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortholePlayer } from './player'

class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function castText(events: Array<[number, string]>, cols = 10, rows = 4): string {
  const header = JSON.stringify({ version: 2, width: cols, height: rows, timestamp: 0 })
  const lines = events.map(([t, d]) => JSON.stringify([t, 'o', d]))
  return [header, ...lines].join('\n')
}

function mockFetch(text: string) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: () => Promise.resolve(text) } as Response)
}

describe('PortholePlayer alt-screen line pitch', () => {
  let root: HTMLElement

  beforeEach(() => {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver
    root = document.createElement('div')
    document.body.appendChild(root)
  })

  afterEach(() => {
    root.remove()
    vi.restoreAllMocks()
  })

  // Box-drawing borders (vim/tmux/htop/lazygit) are glyphs meant to sit
  // edge-to-edge in their cell; the readable-prose line-height used for
  // normal scrollback breaks that connection between rows. `.ph-tui`
  // (porthole.css) tightens it back to a near-1:1 pitch — this was the
  // real, previously-untested bug behind a visibly broken TUI render.
  it('adds ph-tui once a cast enters alt-screen', async () => {
    mockFetch(castText([[0.1, '\x1b[?1049htop line']]))
    const player = new PortholePlayer(root, { reducedMotion: true })
    await player.load('/fake.cast')

    const term = root.querySelector('.ph-term')!
    expect(term.classList.contains('ph-tui')).toBe(true)
    player.destroy()
  })

  it('does not add ph-tui for plain scrollback that never enters alt-screen', async () => {
    mockFetch(castText([[0.1, 'just some scrollback output\r\n']]))
    const player = new PortholePlayer(root, { reducedMotion: true })
    await player.load('/fake.cast')

    const term = root.querySelector('.ph-term')!
    expect(term.classList.contains('ph-tui')).toBe(false)
    player.destroy()
  })

  it('renders an explicit broken-axis marker for real quiet time', async () => {
    mockFetch(castText([[1, 'before\r\n'], [121, 'after']]))
    const player = new PortholePlayer(root, { reducedMotion: true })
    await player.load('/fake.cast')

    const marker = root.querySelector<HTMLButtonElement>('.ph-cut-marker')
    expect(marker).not.toBeNull()
    expect(marker?.getAttribute('aria-label')).toContain('Jump cut')
    expect(root.querySelector('.ph-provenance')?.textContent).toContain('121.0s real')
    expect(root.querySelector('.ph-provenance')?.textContent).toContain('declared jump cut')
    player.destroy()
  })

  it('rewinds the active scene before replaying it', async () => {
    mockFetch(castText([[0.1, 'first\r\n'], [1, 'last']]))
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const player = new PortholePlayer(root, { reducedMotion: true })
    await player.load('/fake.cast')

    const term = root.querySelector('.ph-term')!
    expect(term.textContent).toContain('last')
    root.querySelector<HTMLButtonElement>('[aria-label="Restart from the beginning"]')?.click()
    expect(term.textContent).not.toContain('last')
    player.destroy()
  })

  it('semantically distinguishes anchors, hook injections, and real refusals', async () => {
    mockFetch(castText([[0.1, 'session-proof-123 HARNESSED CONTEXT\\r\\n'], [0.2, "Lock 'refunds-schema' is held by nora\\r\\nREFUSED · command exited 1"]], 80))
    const player = new PortholePlayer(root, { reducedMotion: true })
    await player.load('/fake.cast')

    expect(root.querySelector('.ph-line--anchor')).not.toBeNull()
    expect(root.querySelector('.ph-token--anchor')?.textContent).toContain('session-proof-123')
    expect(root.querySelector('.ph-line--hook')).not.toBeNull()
    expect(root.querySelector('.ph-token--hook')?.textContent).toContain('HARNESSED CONTEXT')
    expect(root.querySelector('.ph-line--error')).not.toBeNull()
    expect([...root.querySelectorAll('.ph-token--error')].map((element) => element.textContent).join('')).toContain('REFUSED')
    player.destroy()
  })
})
