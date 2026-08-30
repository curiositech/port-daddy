// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import parleyEvidence from '@/data/evidence/parley-979f6940.json'
import { ParleySuggestibilityMap } from './ParleySuggestibilityMap'

afterEach(cleanup)

describe('ParleySuggestibilityMap', () => {
  it('renders three distinct parties and the exact shared-read chronology', () => {
    render(<ParleySuggestibilityMap />)

    expect(screen.getByRole('heading', { name: 'Suggestible does not mean obedient.' })).toBeTruthy()
    expect(screen.getByText('Porthole coordinator')).toBeTruthy()
    expect(screen.getByText('Sugar experience owner')).toBeTruthy()
    expect(screen.getByText('Context-pressure owner')).toBeTruthy()

    const turns = document.querySelectorAll('ol[aria-label="Chronological shared-read Parley turns"] > li')
    expect(turns).toHaveLength(8)
    expect(Array.from(turns).map((turn) => turn.textContent?.match(/T\d{2}/)?.[0])).toEqual([
      'T01',
      'T02',
      'T03',
      'T04',
      'T05',
      'T06',
      'T07',
      'T08',
    ])
  })

  it('keeps the durable record visibly convened, unresolved, and receipt-bounded', () => {
    render(<ParleySuggestibilityMap />)

    expect(screen.getByText('CONVENED')).toBeTruthy()
    expect(screen.getByText('still open')).toBeTruthy()
    expect(screen.getByText('Settlement')).toBeTruthy()
    expect(screen.getByText('none')).toBeTruthy()
    expect(screen.getByText('2 withheld')).toBeTruthy()
    expect(screen.getByText('Individual agreements (not settlement)')).toBeTruthy()
    expect(screen.getByText('Two later turns are deliberately not on this page.')).toBeTruthy()
    expect(screen.getAllByText('1 unseen')).toHaveLength(2)
    expect(screen.getByText('caught up')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /settled|unanimous/i })).toBeNull()
  })

  it('proves the fixture projects only the common read frontier', () => {
    expect(parleyEvidence.participants).toHaveLength(3)
    expect(parleyEvidence.status).toBe('CONVENED')
    expect(parleyEvidence.outcome).toBeNull()
    expect(parleyEvidence.turns.map((turn) => turn.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(parleyEvidence.turns.every((turn) => turn.at <= parleyEvidence.commonReadThrough)).toBe(true)
    expect(parleyEvidence.sourceTurnCount - parleyEvidence.displayedTurnCount).toBe(parleyEvidence.withheldTurnCount)
    expect(parleyEvidence.turns).toHaveLength(parleyEvidence.displayedTurnCount)
  })
})
