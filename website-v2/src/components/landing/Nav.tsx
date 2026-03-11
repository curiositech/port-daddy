import * as React from 'react'
import { motion } from 'framer-motion'
import { Link, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme'

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

const NAV_LINKS = [
  { label: 'Claude Code', href: '/mcp', internal: true },
  { label: 'Docs', href: '/docs', internal: true },
  { label: 'Tutorials', href: '/tutorials', internal: true },
  { label: 'GitHub', href: 'https://github.com/erichowens/port-daddy', external: true },
]

export function Nav() {
  const [scrolled, setScrolled] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [heroVisible, setHeroVisible] = React.useState(true)
  const { theme, toggle } = useTheme()
  const location = useLocation()

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  React.useEffect(() => {
    const hero = document.getElementById('hero')
    if (!hero) return
    const observer = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry.isIntersecting),
      { threshold: 0.05 }
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [location.pathname])

  // Close mobile menu on route change
  React.useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const isHome = location.pathname === '/'

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: scrolled || !isHome ? 'var(--nav-bg)' : 'transparent',
        borderBottom: scrolled || !isHome ? '1px solid var(--nav-border)' : '1px solid transparent',
        backdropFilter: scrolled || !isHome ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: scrolled || !isHome ? 'blur(16px)' : 'none',
        transition: 'background 200ms ease, border-color 200ms ease, backdrop-filter 200ms ease',
      }}
    >
      <nav
        className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between"
        style={{ height: 'var(--nav-height)' }}
      >
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 no-underline">
          {!heroVisible && (
            <img
              src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
              alt="Port Daddy"
              style={{ height: '36px', width: 'auto', display: 'block' }}
            />
          )}
          <span
            className="font-bold text-base tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--p-font-display)' }}
          >
            Port Daddy
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(link => (
            link.internal ? (
              <Link
                key={link.label}
                to={link.href}
                className="text-sm font-medium transition-colors no-underline"
                style={{
                  color: location.pathname === link.href ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = location.pathname === link.href ? 'var(--text-primary)' : 'var(--text-secondary)')}
              >
                {link.label}
              </Link>
            ) : (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium transition-colors no-underline"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                {link.label}
              </a>
            )
          ))}

          {/* Theme toggle */}
          <button
            onClick={toggle}
            className="p-2 rounded-lg transition-colors"
            style={{
              color: 'var(--text-secondary)',
              background: 'transparent',
              border: '1px solid var(--border-subtle)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--bg-overlay)'
              e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--text-secondary)'
            }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <Button
            size="sm"
            onClick={() => {
              if (isHome) {
                document.getElementById('install')?.scrollIntoView({ behavior: 'smooth' })
              } else {
                window.location.href = '/#install'
              }
            }}
          >
            Install
          </Button>
        </div>

        {/* Mobile controls */}
        <div className="md:hidden flex items-center gap-2">
          <button
            onClick={toggle}
            className="p-2 rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="p-2 rounded-lg"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile menu */}
      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden px-4 pb-4"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--nav-bg)', backdropFilter: 'blur(16px)' }}
        >
          <div className="flex flex-col gap-1 pt-3">
            {NAV_LINKS.map(link => (
              link.internal ? (
                <Link
                  key={link.label}
                  to={link.href}
                  className="px-3 py-2 rounded-lg text-sm font-medium no-underline"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg text-sm font-medium no-underline"
                  style={{ color: 'var(--text-secondary)' }}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </a>
              )
            ))}
            <Button size="sm" className="mt-2">Install</Button>
          </div>
        </motion.div>
      )}
    </motion.header>
  )
}
