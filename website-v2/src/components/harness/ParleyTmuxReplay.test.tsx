// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParleyTmuxReplay } from './ParleyTmuxReplay'

vi.mock('@/components/porthole/PortholeEmbed', () => ({
  PortholeEmbed: ({ src, label }: { src: string; label: string }) => (
    <div data-testid="porthole-replay" data-src={src} aria-label={label} />
  ),
}))

afterEach(cleanup)

describe('ParleyTmuxReplay', () => {
  it('shows the real protocol-source cast with three named participants and a read-only witness', () => {
    render(<ParleyTmuxReplay />)

    expect(screen.getByRole('heading', { name: 'See the shared moment. Then inspect every pane.' })).toBeTruthy()
    expect(screen.getByTestId('porthole-replay').getAttribute('data-src')).toBe('/casts/porthole/parley-source.cast')
    expect(screen.getAllByText('Nora')).toHaveLength(2)
    expect(screen.getAllByText('Milo')).toHaveLength(2)
    expect(screen.getAllByText('Aya')).toHaveLength(2)
    expect(screen.getByText('Port Daddy witness')).toBeTruthy()
    expect(screen.getByText('Three real shells')).toBeTruthy()
    expect(screen.getByText('Six durable turns')).toBeTruthy()
    expect(screen.queryByText(/Target doctrine/i)).toBeNull()
    expect(screen.queryByRole('heading', { name: /If Nora is offline/i })).toBeNull()
  })

  it('renders four independently focusable pane histories captured by tmux before teardown', () => {
    render(<ParleyTmuxReplay />)

    expect(screen.getByRole('heading', { name: 'Four panes. Four real histories. Scroll each one.' })).toBeTruthy()
    const histories = screen.getAllByRole('region', { name: /tmux pane scrollback/i })
    expect(histories).toHaveLength(4)
    expect(histories.map((history) => history.getAttribute('tabindex'))).toEqual(['0', '0', '0', '0'])
    expect(screen.getByRole('region', { name: /Nora tmux pane scrollback/i }).textContent).toContain('NORA◆')
    expect(screen.getByRole('region', { name: /Milo tmux pane scrollback/i }).textContent).toContain('MILO◇')
    expect(screen.getByRole('region', { name: /Aya tmux pane scrollback/i }).textContent).toContain('AYA●')
    expect(screen.getByRole('region', { name: /Port Daddy tmux pane scrollback/i }).textContent).toContain('PORT DADDY WITNESS')
    expect(screen.getAllByRole('button', { name: /tmux pane scrollback to latest/i })).toHaveLength(4)

    const [nora, milo] = histories
    Object.defineProperty(nora, 'scrollHeight', { configurable: true, value: 1_200 })
    nora.scrollTop = 120
    milo.scrollTop = 47
    fireEvent.click(screen.getByRole('button', { name: 'Jump Nora tmux pane scrollback to latest' }))
    expect(nora.scrollTop).toBe(1_200)
    expect(milo.scrollTop).toBe(47)
  })

  it('states the public-rationale and deterministic-fixture boundaries without claiming private thought', () => {
    render(<ParleyTmuxReplay />)

    expect(screen.getByText(/public explanations and protocol receipts, not private chain of thought/i)).toBeTruthy()
    expect(screen.getByText(/does not claim three independently sampled model minds/i)).toBeTruthy()
    expect(screen.getByText(/cannot mark a turn read/i)).toBeTruthy()
    expect(screen.getByText(/cannot be reconstructed honestly in the browser/i)).toBeTruthy()
  })
})
