// @vitest-environment jsdom

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  it('starts with one real Porthole witness and explains the agent, Port Daddy, and Porthole plainly', () => {
    render(
      <MemoryRouter>
        <HarnessPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'See what the agent saw before it acted.' })).toBeTruthy()
    expect(screen.getByText('The agent does the work.')).toBeTruthy()
    expect(screen.getByText('Port Daddy governs the work.')).toBeTruthy()
    expect(screen.getByText('Porthole makes the evidence inspectable.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Choose the moment you want to verify.' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'A contested action stops in unmistakable red.' })).toBeTruthy()

    const portholes = screen.getAllByTestId('porthole-embed')
    expect(portholes).toHaveLength(3)
    expect(portholes.map((porthole) => porthole.getAttribute('data-src'))).toEqual([
      '/casts/porthole/collision.cast',
      '/casts/porthole/parley.cast',
      '/casts/porthole/parley-source.cast',
    ])
  })

  it('restarts the evidence workbench on the selected current-contract cast', () => {
    render(
      <MemoryRouter>
        <HarnessPage />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /02 · Before the decision/i }))
    expect(screen.getAllByTestId('porthole-embed')[0].getAttribute('data-src')).toBe('/casts/porthole/harness-next-turn.cast')
    expect(screen.getByRole('heading', { name: 'The model sees bounded context, not transport sludge.' })).toBeTruthy()
    expect(screen.getByText('sha256 e18b129c3476')).toBeTruthy()
  })

  it('keeps source-only, join-only, and proposed contexts visibly unplayed', () => {
    render(
      <MemoryRouter>
        <HarnessPage />
      </MemoryRouter>,
    )

    expect(screen.getAllByText('Source · needs capture').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Integration join').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Proposed').length).toBeGreaterThan(0)
    expect(screen.getByText('Retired PostToolUse; no per-tool process fan-out')).toBeTruthy()
    expect(screen.getByText('A cast is not a WorkReceipt. Porthole will attach to the canonical receipt instead of inventing a second authority.')).toBeTruthy()
  })

  it('backs every selectable scene with the exact non-empty cast digest published on the page', () => {
    const expected = new Map([
      ['quickstart.cast', '662c843071e09ecc8570881d9852c67ba118da486e8440723fb637bdc9a68c5e'],
      ['harness-next-turn.cast', 'e18b129c34767d7afd67d03d2d0a04b5d664c68ccfbc0c17ceac66205351804b'],
      ['collision.cast', '37aa832e2ba4b2cecf9f0a5f02aced2fcad38d4ee37925bdbf426f9f185fd36b'],
      ['visibility.cast', '552c9fc69435bb22d5d4913d5126e08670348246528a03201a49eed02c5bb5e0'],
      ['ports.cast', '771b81d817c78af80967112bb0f8ae15cd7aaee3b16136b2127cf4795f58d241'],
      ['parley.cast', '2a25a0516bd61dfa23022378586176bfe8da088e58610a7f55e5e38dadc8d1c6'],
      ['parley-source.cast', 'f90e60937b6141d287274ab1f5b863e4f4f63f9e8100cc138f7f79365941b9d0'],
    ])

    for (const [cast, digest] of expected) {
      const bytes = readFileSync(resolve(process.cwd(), `public/casts/porthole/${cast}`))
      const records = bytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line) as unknown)

      expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest)
      expect(records.length).toBeGreaterThan(1)
      expect(records[0]).toMatchObject({ version: 3 })
      expect(records.slice(1).some((record) => Array.isArray(record) && record[1] === 'o' && typeof record[2] === 'string')).toBe(true)
    }
  })

  it('rejects retired hook choreography and old static harness media from the page contract', () => {
    const pageSource = readFileSync(resolve(process.cwd(), 'src/pages/HarnessPage.tsx'), 'utf8')
    const recorderSource = readFileSync(resolve(process.cwd(), 'scripts/record-harness-proof-scenarios.mjs'), 'utf8')
    const gallerySource = readFileSync(resolve(process.cwd(), 'scripts/build-harness-transcript-gallery.mjs'), 'utf8')
    const captureSource = readFileSync(resolve(process.cwd(), 'scripts/capture-harness-transcript-gallery.mjs'), 'utf8')
    const harnessFixture = recorderSource.slice(
      recorderSource.indexOf("if (wants('harness-next-turn'))"),
      recorderSource.indexOf("if (wants('collision'))"),
    )

    expect(pageSource).not.toMatch(/<img|\.gif|\/demos\/harness\/|HarnessLifecycleVessel|ParleySuggestibilityMap/)
    expect(harnessFixture).not.toContain('pd-hook-post-tool')
    expect(harnessFixture).not.toContain('PD_HOOK_POST')
    expect(gallerySource).not.toContain('PostToolUse → Ink Cloud → UserPromptSubmit')
    expect(captureSource).toContain("page.locator('#proof-workbench')")
    expect(captureSource).toContain("page.locator('#parley-primary-proof')")
    expect(captureSource).not.toContain("page.locator('#what-is-a-harness')")
    expect(captureSource).not.toContain("page.locator('#parley-suggestibility')")

    for (const retiredFile of [
      'src/components/harness/HarnessLifecycleVessel.tsx',
      'src/components/harness/HarnessLifecycleVessel.test.tsx',
      'src/components/harness/harness-lifecycle-vessel.css',
      'src/components/harness/ParleySuggestibilityMap.tsx',
      'src/components/harness/ParleySuggestibilityMap.test.tsx',
    ]) {
      expect(existsSync(resolve(process.cwd(), retiredFile))).toBe(false)
    }
  })
})
