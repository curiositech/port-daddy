import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@/lib/theme'
import { Sun, Moon, Github, Menu, X, ChevronDown, BookOpen, GraduationCap, LayoutGrid } from 'lucide-react'

interface NavItem {
  label: string
  href: string
  description?: string
  icon?: React.ElementType
}

interface NavSection {
  label: string
  href: string
  items?: NavItem[]
}

// Simplified navigation structure (3 main items instead of 8)
const NAV_STRUCTURE: NavSection[] = [
  {
    label: 'Get Started',
    href: '/tutorials',
    items: [
      { 
        label: 'Tutorials', 
        href: '/tutorials',
        description: 'Step-by-step guides for beginners',
        icon: GraduationCap
      },
      { 
        label: 'Templates', 
        href: '/templates',
        description: 'Pre-configured project templates',
        icon: LayoutGrid
      },
      { 
        label: 'Blueprints', 
        href: '/examples',
        description: 'Real-world integration examples',
        icon: BookOpen
      },
    ]
  },
  {
    label: 'Documentation',
    href: '/docs',
    items: [
      { 
        label: 'CLI Reference', 
        href: '/docs/cli',
        description: 'Command-line interface docs',
        icon: BookOpen
      },
      { 
        label: 'TypeScript SDK', 
        href: '/docs/sdk',
        description: 'Programmatic API reference',
        icon: BookOpen
      },
      { 
        label: 'MCP Tools', 
        href: '/docs/mcp',
        description: 'AI assistant integrations',
        icon: BookOpen
      },
      { 
        label: 'Whitepaper', 
        href: '/whitepaper',
        description: 'Technical specification',
        icon: BookOpen
      },
    ]
  },
  {
    label: 'Community',
    href: '/blog',
    items: [
      { 
        label: 'Blog', 
        href: '/blog',
        description: 'Engineering insights & updates',
        icon: BookOpen
      },
      { 
        label: 'Roadmap', 
        href: '/roadmap',
        description: 'Upcoming features',
        icon: LayoutGrid
      },
      { 
        label: 'GitHub', 
        href: 'https://github.com/erichowens/port-daddy',
        description: 'Source code & issues',
        icon: Github,
      },
    ]
  },
]

function DropdownNav({ section }: { section: NavSection }) {
  const [isOpen, setIsOpen] = React.useState(false)
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const location = useLocation()
  const isActive = location.pathname.startsWith(section.href)

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 150)
  }

  // Clean up timeout on unmount
  React.useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current)
      }
    }
  }, [])

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        to={section.href}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
          isActive
            ? 'text-[var(--brand-primary)] bg-[var(--interactive-active)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)]'
        }`}
      >
        {section.label}
        {section.items && <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
      </Link>

      {section.items && isOpen && (
        <>
          {/* Invisible bridge between trigger and dropdown to prevent close on gap crossing */}
          <div className="absolute top-full left-0 w-full h-2" />
          <div className="absolute top-full left-0 pt-2 w-64 z-50">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl shadow-[var(--shadow-lg)] py-2">
              {section.items.map((item) => {
                const Icon = item.icon || BookOpen
                const isExternal = item.href.startsWith('http')
                return (
                  <Link
                    key={item.label}
                    to={item.href}
                    target={isExternal ? '_blank' : undefined}
                    rel={isExternal ? 'noopener noreferrer' : undefined}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--interactive-hover)] transition-colors"
                    onClick={() => setIsOpen(false)}
                  >
                    <Icon size={18} className="text-[var(--text-muted)] mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {item.label}
                        {isExternal && <span className="ml-1 text-[var(--text-muted)]">↗</span>}
                      </div>
                      {item.description && (
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          {item.description}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function Nav() {
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const { theme, toggle } = useTheme()

  React.useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      {/* Skip Link for Accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-[var(--brand-primary)] focus:text-[var(--brand-on-primary)] focus:rounded-lg focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>
      <nav 
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
          scrolled 
            ? 'bg-[var(--bg-base)]/80 backdrop-blur-xl border-b border-[var(--border-subtle)]' 
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 no-underline group">
              <div className="w-8 h-8 rounded-lg bg-[var(--brand-primary)] flex items-center justify-center">
                <img
                  src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
                  alt="Port Daddy"
                  className="h-5 w-auto"
                />
              </div>
              <span className="font-semibold text-lg tracking-tight text-[var(--text-primary)]">
                Port Daddy
              </span>
            </Link>

            {/* Desktop Navigation - Simplified (3 items with dropdowns) */}
            <div className="hidden lg:flex items-center gap-1">
              {NAV_STRUCTURE.map((section) => (
                <DropdownNav key={section.label} section={section} />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggle}
                className="p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)] transition-all"
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              </button>

              <a
                href="https://github.com/erichowens/port-daddy"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)] transition-all"
              >
                <Github size={18} />
                <span>Star</span>
              </a>

              <Link
                to="/tutorials/getting-started"
                className="hidden sm:flex items-center px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all"
              >
                Get Started
              </Link>

              <button
                className="lg:hidden p-2 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--interactive-hover)] transition-all"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Toggle menu"
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu - Updated with new structure */}
        {mobileOpen && (
          <div className="lg:hidden bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 space-y-6">
              {NAV_STRUCTURE.map((section) => (
                <div key={section.label}>
                  <Link
                    to={section.href}
                    className="block text-sm font-semibold text-[var(--text-primary)] mb-2"
                    onClick={() => setMobileOpen(false)}
                  >
                    {section.label}
                  </Link>
                  {section.items && (
                    <div className="space-y-1 pl-4">
                      {section.items.map((item) => {
                        const isExternal = item.href.startsWith('http')
                        return (
                          <Link
                            key={item.label}
                            to={item.href}
                            target={isExternal ? '_blank' : undefined}
                            rel={isExternal ? 'noopener noreferrer' : undefined}
                            className="block py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={() => setMobileOpen(false)}
                          >
                            {item.label}
                            {isExternal && <span className="ml-1 text-[var(--text-muted)]">↗</span>}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-4 border-t border-[var(--border-subtle)]">
                <Link
                  to="/tutorials/getting-started"
                  className="block w-full text-center px-4 py-3 rounded-lg bg-primary text-primary-foreground font-semibold"
                  onClick={() => setMobileOpen(false)}
                >
                  Get Started
                </Link>
              </div>
            </div>
          </div>
        )}
      </nav>
    </>
  )
}
