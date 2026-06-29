import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * ScrollToTop — resets the viewport to the top on every route (pathname) change.
 *
 * Single-page apps keep the previous scroll position when the path changes, so
 * clicking a nav link lands you at whatever offset you had scrolled to on the
 * last page. This restores the expected "new page starts at the top" behavior.
 *
 * Anchored navigation (a URL with a #hash) is left alone — HashScroll owns that
 * and will scroll to the target element instead.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation()

  useEffect(() => {
    if (hash) return
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [pathname, hash])

  return null
}
