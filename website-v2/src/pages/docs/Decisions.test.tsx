// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import Decisions from './Decisions'

afterEach(() => {
  cleanup()
})

describe('Decisions page', () => {
  test('renders without crashing and shows the page heading', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    expect(screen.getAllByText(/Architecture Decision Records/i).length).toBeGreaterThanOrEqual(1)
  })

  test('renders at least one ADR card', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    const cards = screen.getAllByTestId('adr-card')
    expect(cards.length).toBeGreaterThanOrEqual(1)
  })

  test('ADR-0026 appears first (newest-first order)', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    const cards = screen.getAllByTestId('adr-card')
    expect(cards[0].textContent).toContain('0026')
  })

  test('ADR-0001 appears last (newest-first order)', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    const cards = screen.getAllByTestId('adr-card')
    expect(cards[cards.length - 1].textContent).toContain('0001')
  })

  test('each ADR card links to GitHub', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    const links = screen.getAllByText(/Read full ADR on GitHub/i)
    expect(links.length).toBeGreaterThanOrEqual(1)
    for (const link of links) {
      const href = link.closest('a')?.getAttribute('href') ?? ''
      expect(href).toContain('github.com/curiositech/port-daddy')
    }
  })

  test('does not expose internal ADR voice — no "Open Questions" or "Considered Options"', () => {
    render(
      <MemoryRouter>
        <Decisions />
      </MemoryRouter>,
    )
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Open Questions')
    expect(text).not.toContain('Considered Options')
  })
})
