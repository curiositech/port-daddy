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
})
