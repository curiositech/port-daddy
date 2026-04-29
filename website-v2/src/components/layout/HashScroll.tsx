import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function HashScroll() {
  const { pathname, hash, key } = useLocation()

  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    if (!id) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduced ? 'auto' : 'smooth'

    let cancelled = false
    let attempts = 0
    const tryScroll = () => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (el) {
        el.scrollIntoView({ behavior, block: 'start' })
        return
      }
      if (attempts++ < 20) {
        window.requestAnimationFrame(tryScroll)
      }
    }
    tryScroll()

    return () => {
      cancelled = true
    }
  }, [pathname, hash, key])

  return null
}
