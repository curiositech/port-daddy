// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import LandscapePage from './index'

afterEach(() => {
  cleanup()
})

describe('Landscape page', () => {
  test('renders the hero title positioning PD as the layer underneath', () => {
    render(
      <MemoryRouter>
        <LandscapePage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /not a rival\.\s*it is the layer underneath/i,
      }),
    ).toBeTruthy()
  })

  test('comparison table has all five tools and a "Composes with PD?" column', () => {
    render(
      <MemoryRouter>
        <LandscapePage />
      </MemoryRouter>,
    )
    const table = screen.getByTestId('landscape-comparison')
    expect(table).toBeTruthy()
    const tableContent = table.textContent ?? ''
    expect(tableContent).toContain('Port Daddy')
    expect(tableContent).toContain('Cursor 2.0')
    expect(tableContent).toContain('Claude Code Task')
    expect(tableContent).toContain('ccswarm')
    expect(tableContent).toContain('Jury-rig')
    expect(tableContent).toMatch(/Composes with PD\?/i)
    // Honest-comparison footnote
    expect(tableContent).toMatch(/None of these are competitors/i)
  })

  test('renders all four architecture layers, with Port Daddy on the coordination layer', () => {
    render(
      <MemoryRouter>
        <LandscapePage />
      </MemoryRouter>,
    )
    const isolation = screen.getByTestId('landscape-layer-isolation')
    const communication = screen.getByTestId('landscape-layer-communication')
    const coordination = screen.getByTestId('landscape-layer-coordination')
    const integration = screen.getByTestId('landscape-layer-integration')
    expect(isolation).toBeTruthy()
    expect(communication).toBeTruthy()
    expect(coordination).toBeTruthy()
    expect(integration).toBeTruthy()
    expect(within(coordination).getByText(/Port Daddy lives here/i)).toBeTruthy()
  })

  test('walkthrough section uses the canonical semantic identities', () => {
    render(
      <MemoryRouter>
        <LandscapePage />
      </MemoryRouter>,
    )
    const walkthrough = screen.getByTestId('landscape-walkthrough')
    const text = walkthrough.textContent ?? ''
    expect(text).toContain('claude:auth-rewrite')
    expect(text).toContain('codex:auth-tests')
    expect(text).toMatch(/pd salvage/)
    expect(text).toMatch(/CONFLICT/)
  })

  test('exposes the three section headings', () => {
    render(
      <MemoryRouter>
        <LandscapePage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { level: 2, name: /Five tools, five different jobs/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 2, name: /Four layers/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { level: 2, name: /Two agents on the same repo/i }),
    ).toBeTruthy()
  })
})
