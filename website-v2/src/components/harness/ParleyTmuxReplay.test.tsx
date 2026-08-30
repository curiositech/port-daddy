// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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

    expect(screen.getByRole('heading', { name: 'The Parley, as it actually happened.' })).toBeTruthy()
    expect(screen.getByTestId('porthole-replay').getAttribute('data-src')).toBe('/casts/porthole/parley-source.cast')
    expect(screen.getByText('Nora')).toBeTruthy()
    expect(screen.getByText('Milo')).toBeTruthy()
    expect(screen.getByText('Aya')).toBeTruthy()
    expect(screen.getByText('Port Daddy witness')).toBeTruthy()
    expect(screen.getByText('Three real shells')).toBeTruthy()
    expect(screen.getByText('Six durable turns')).toBeTruthy()
  })

  it('states the public-rationale and deterministic-fixture boundaries without claiming private thought', () => {
    render(<ParleyTmuxReplay />)

    expect(screen.getByText(/public explanations and protocol receipts, not private chain of thought/i)).toBeTruthy()
    expect(screen.getByText(/does not claim three independently sampled model minds/i)).toBeTruthy()
    expect(screen.getByText(/cannot mark a turn read/i)).toBeTruthy()
  })
})
