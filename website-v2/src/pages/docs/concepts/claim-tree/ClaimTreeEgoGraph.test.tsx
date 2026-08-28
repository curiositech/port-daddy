// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  CLAIM_TREE_TROUBLE_STATES,
  ClaimTreeEgoGraph,
} from './ClaimTreeEgoGraph'

vi.mock('@/components/ui/Mermaid', () => ({
  Mermaid: ({ chart }: { chart: string }) => (
    <pre data-testid="mermaid-chart">{chart}</pre>
  ),
}))

function installMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduced && query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList),
  )
}

describe('ClaimTreeEgoGraph', () => {
  beforeEach(() => {
    installMatchMedia(false)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders an accessible state legend and keeps the inspector in sync', () => {
    render(<ClaimTreeEgoGraph />)

    expect(screen.getByTestId('claimtree-trouble-viz').getAttribute('data-motion')).toBe('full')
    expect(screen.getByTestId('claimtree-trouble-viz').getAttribute('data-selected-state')).toBe(
      'COORDINATE',
    )

    expect(CLAIM_TREE_TROUBLE_STATES.map(({ state }) => state)).toEqual([
      'VERIFY',
      'RESCUE',
      'COORDINATE',
      'INSPECT',
      'RECONCILE',
      'WATCH',
      'PROCEED',
    ])

    for (const { state } of CLAIM_TREE_TROUBLE_STATES) {
      expect(screen.getByRole('button', { name: new RegExp(`^${state}:`, 'i') })).toBeTruthy()
    }

    const inspector = screen.getByRole('status')
    expect(inspector.textContent).toContain('Coordinate overlap')
    expect(inspector.textContent).toContain('two live sessions claim the same declared surface')
    expect(inspector.textContent).toContain(
      'open a parley, hand off, or split the surface before proceeding',
    )
    expect(screen.getByTestId('mermaid-chart').textContent).toContain('STATE{{"COORDINATE"}}')

    fireEvent.click(screen.getByRole('button', { name: /verify provenance/i }))

    expect(screen.getByTestId('claimtree-trouble-viz').getAttribute('data-selected-state')).toBe(
      'VERIFY',
    )
    expect(screen.getByRole('status').textContent).toContain('Verify provenance')
    expect(screen.getByRole('status').textContent).toContain(
      'claim provenance is incomplete or names different worlds',
    )
    expect(screen.getByTestId('mermaid-chart').textContent).toContain('STATE{{"VERIFY"}}')
    expect(screen.getByTestId('mermaid-chart').textContent).toContain('claimtreeStateVerify')
  })

  it('marks reduced motion on the root figure', () => {
    installMatchMedia(true)

    render(<ClaimTreeEgoGraph />)

    expect(screen.getByTestId('claimtree-trouble-viz').getAttribute('data-motion')).toBe(
      'reduced',
    )
    expect(screen.getByRole('status').textContent).toContain('Coordinate overlap')
  })
})
