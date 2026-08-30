// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  it('explains the four layers, mounts the lifecycle vessel, and keeps both proofs distinct', () => {
    render(
      <MemoryRouter>
        <HarnessPage />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('harness-lifecycle-vessel')).toBeTruthy()
    expect(screen.getByRole('heading', { name: /Know which agents are protected before they act/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /A harness is the safety and continuity layer around an agent/i })).toBeTruthy()
    expect(screen.getByText('The worker at the keyboard.')).toBeTruthy()
    expect(screen.getByText('The seat belt, dashboard, and flight recorder around the worker.')).toBeTruthy()
    expect(screen.getByText('The team’s durable control plane.')).toBeTruthy()
    expect(screen.getByText('The evidence window you can pause and inspect.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'The Parley, as it actually happened.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Suggestible does not mean obedient.' })).toBeTruthy()
    expect(document.querySelector('#capabilities')).toBeTruthy()

    const portholes = screen.getAllByTestId('porthole-embed')
    expect(portholes).toHaveLength(3)
    expect(portholes.map((porthole) => porthole.getAttribute('data-src'))).toEqual([
      '/casts/porthole/parley-source.cast',
      '/casts/porthole/harness-next-turn.cast',
      '/casts/porthole/parley.cast',
    ])
  })

  it('backs all three embeds with valid, non-empty asciinema casts', () => {
    for (const cast of ['harness-next-turn.cast', 'parley-source.cast', 'parley.cast']) {
      const castPath = resolve(process.cwd(), `public/casts/porthole/${cast}`)
      const records = readFileSync(castPath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as unknown)

      expect(records.length).toBeGreaterThan(1)
      expect(records[0]).toMatchObject({ version: 3 })
      expect(
        records.slice(1).some((record) => Array.isArray(record) && record[1] === 'o' && typeof record[2] === 'string'),
      ).toBe(true)
    }
  })
})
