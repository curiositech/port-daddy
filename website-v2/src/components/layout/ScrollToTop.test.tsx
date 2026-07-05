// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScrollToTop } from './ScrollToTop'

function renderRoutes(initialEntry = '/first') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ScrollToTop />
      <Routes>
        <Route
          path="*"
          element={
            <nav aria-label="Test navigation">
              <Link to="/second">Second</Link>
              <Link to="/second#target">Second anchor</Link>
            </nav>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScrollToTop', () => {
  it('scrolls to the top on pathname navigation', () => {
    renderRoutes()
    const scrollTo = vi.mocked(window.scrollTo)
    scrollTo.mockClear()

    fireEvent.click(screen.getByRole('link', { name: 'Second' }))

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })

  it('defers hash navigation to HashScroll', () => {
    renderRoutes()
    const scrollTo = vi.mocked(window.scrollTo)
    scrollTo.mockClear()

    fireEvent.click(screen.getByRole('link', { name: 'Second anchor' }))

    expect(scrollTo).not.toHaveBeenCalled()
  })
})
