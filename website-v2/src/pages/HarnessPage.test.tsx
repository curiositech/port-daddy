// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/harness/HarnessLifecycleVessel', () => ({
  HarnessLifecycleVessel: () => <div data-testid="harness-lifecycle-vessel" />,
}))

vi.mock('@/components/porthole/PortholeEmbed', () => ({
  PortholeEmbed: ({ src, label }: { src: string; label: string }) => (
    <div data-src={src} data-testid="porthole-embed">
      {label}
    </div>
  ),
}))

import HarnessPage from './HarnessPage'

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
})

describe('HarnessPage', () => {
  it('mounts the lifecycle vessel and both replayable Porthole proofs', () => {
    render(
      <MemoryRouter>
        <HarnessPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('harness-lifecycle-vessel')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Know which agents are protected before they act/i })).toBeTruthy()

    const portholes = screen.getAllByTestId('porthole-embed')
    expect(portholes).toHaveLength(2)
    expect(portholes.every((porthole) => porthole.getAttribute('data-src') === '/casts/porthole/harness-next-turn.cast')).toBe(true)
  })
})
