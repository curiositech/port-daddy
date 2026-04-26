import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTheme } from '@/lib/theme-context'
import { Sun, Moon, Github, Menu, X, ChevronDown, BookOpen, GraduationCap, LayoutGrid, Bot, Code2, ChefHat } from 'lucide-react'
import { DocsSearch } from '@/components/docs/DocsSearch'
import { openDocsSearch } from '@/components/docs/docsSearchEvents'

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
        label: 'Examples',
        href: '/examples',
        description: 'Runnable patterns by primitive',
        icon: Code2
      },
      {
        label: 'Cookbook',
        href: '/cookbook',
        description: 'Long-form recipes for coordination, scaling, resilience',
        icon: ChefHat
      },
      {
        label: 'Fleet Agents',
        href: '/agents',
        description: 'Meet the 8 agent archetypes',
        icon: Bot
      },
      {
        label: 'Prompting Guide',
        href: '/docs/guides/prompting-agents',
        description: 'Write reliable prompts for coordinated agents',
        icon: LayoutGrid
      },
      {
        label: 'Template Quickstarts',
        href: '/docs/guides/templates',
        description: 'Starter fleets for common workflows',
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
        href: 'https://github.com/curiositech/port-daddy',
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

  const cancelClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }

  const scheduleClose = (delay = 150) => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, delay)
  }

  const handleMouseEnter = () => {
    cancelClose()
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    scheduleClose()
  }

  const handleFocus = () => {
    cancelClose()
    setIsOpen(true)
  }

  const handleBlur = () => {
    // Delay so that clicking/tabbing to a child element cancels the close
    scheduleClose(150)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && isOpen) {
      setIsOpen(false)
    }
  }

  // Clean up timeout on unmount
  React.useEffect(() => {
    return () => {
      cancelClose()
    }
  }, [])

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <Link
        to={section.href}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium transition-all ${
          isActive
            ? 'text-[var(--brand-primary)]'
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
        }`}
        style={isActive ? { boxShadow: 'var(--shadow-pressed)' } : undefined}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        {section.label}
        {section.items && <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
      </Link>

      {section.items && isOpen && (
        <>
          {/* Invisible bridge between trigger and dropdown to prevent close on gap crossing */}
          <div className="absolute top-full left-0 w-full h-2" />
          <div className="absolute top-full left-0 pt-2 w-64 z-50">
            <div
              className="rounded-[var(--radius-lg)] py-2"
              role="menu"
              style={{
                background: 'var(--surface-raised)',
                boxShadow: 'var(--shadow-raised)',
              }}
            >
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
                    role="menuitem"
                    onClick={() => setIsOpen(false)}
                  >
                    <Icon size={18} className="text-[var(--text-muted)] mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {item.label}
                      </div>
                      {item.description && (
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">
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
  const location = useLocation()

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
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-[var(--brand-primary)] focus:text-[var(--text-inverse)] focus:rounded-lg focus:font-medium"
        style={{ boxShadow: 'var(--shadow-raised)' }}
      >
        Skip to main content
      </a>
      <nav
        className={`fixed top-0 left-0 right-0 z-[100] transition-all duration-300 ${
          scrolled
            ? 'bg-[var(--surface-base)]/80 backdrop-blur-xl'
            : 'bg-transparent'
        }`}
        style={scrolled ? { boxShadow: 'var(--shadow-flat)' } : undefined}
      >
        <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2.5 no-underline group">
              <div
                className="w-8 h-8 rounded-[var(--radius-sm)] bg-[var(--brand-primary)] flex items-center justify-center"
                style={{ boxShadow: 'var(--shadow-sm)' }}
              >
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

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              <Link
                to="/"
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors no-underline ${
                  location.pathname === '/'
                    ? 'text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Home
              </Link>
              {NAV_STRUCTURE.map((section) => (
                <DropdownNav key={section.label} section={section} />
              ))}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <div className="hidden md:block">
                <DocsSearch variant="compact" />
              </div>

              <button
                onClick={openDocsSearch}
                className="md:hidden w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                style={{ boxShadow: 'var(--shadow-inset)' }}
                aria-label="Search documentation"
              >
                <BookOpen size={16} />
              </button>

              <button
                onClick={toggle}
                className="w-11 h-11 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                style={{ boxShadow: 'var(--shadow-inset)' }}
                aria-label="Toggle theme"
              >
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>

              <a
                href="https://github.com/curiositech/port-daddy"
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-sm)] text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
              >
                <Github size={18} />
                <span>Star</span>
              </a>

              <Link
                to="/tutorials/getting-started"
                className="hidden sm:flex items-center px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--brand-primary)] text-[var(--text-inverse)] text-sm font-semibold transition-all hover:opacity-90"
                style={{ boxShadow: 'var(--shadow-sm)' }}
                onMouseDown={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-flat)'
                }}
                onMouseUp={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-sm)'
                }}
              >
                Get Started
              </Link>

              <button
                className="lg:hidden w-11 h-11 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Toggle menu"
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu - Raised neumorphic panel */}
        {mobileOpen && (
          <div
            className="lg:hidden max-h-[80vh] overflow-y-auto"
            style={{
              background: 'var(--surface-raised)',
              boxShadow: 'var(--shadow-raised)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMobileOpen(false)
            }}
          >
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
                            className="block py-3 min-h-[44px] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={() => setMobileOpen(false)}
                          >
                            {item.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
              <div className="pt-4">
                <Link
                  to="/tutorials/getting-started"
                  className="block w-full text-center px-4 py-3 rounded-[var(--radius-sm)] bg-[var(--brand-primary)] text-[var(--text-inverse)] font-semibold"
                  style={{ boxShadow: 'var(--shadow-sm)' }}
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
