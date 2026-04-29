import * as React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Github, Menu, Moon, Sun, X, ChevronDown, BookOpen, GraduationCap, LayoutGrid, Bot } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DocsSearch, openDocsSearch } from '@/components/docs/DocsSearch'
import { useTheme } from '@/lib/theme'
import { BrandWordmark, PageContainer, PanelEyebrow, SurfacePanel } from '@/components/site/primitives'

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

const NAV_STRUCTURE: NavSection[] = [
  {
    label: 'Get Started',
    href: '/tutorials',
    items: [
      {
        label: 'Tutorials',
        href: '/tutorials',
        description: 'Step-by-step guides for first install and first fleet.',
        icon: GraduationCap,
      },
      {
        label: 'Fleet Agents',
        href: '/tutorials/fleet',
        description: 'Meet the built-in agent archetypes and their roles.',
        icon: Bot,
      },
      {
        label: 'Prompting Guide',
        href: '/docs/guides/prompting-agents',
        description: 'Write reliable prompts for coordinated agents.',
        icon: LayoutGrid,
      },
      {
        label: 'Template Quickstarts',
        href: '/docs/guides/templates',
        description: 'Starter fleets for common workflows.',
        icon: BookOpen,
      },
    ],
  },
  {
    label: 'Documentation',
    href: '/docs',
    items: [
      {
        label: 'CLI Reference',
        href: '/docs/cli',
        description: 'Command-line interface docs.',
        icon: BookOpen,
      },
      {
        label: 'TypeScript SDK',
        href: '/docs/sdk',
        description: 'Programmatic API reference.',
        icon: BookOpen,
      },
      {
        label: 'MCP Tools',
        href: '/docs/mcp',
        description: 'Assistant integrations and tooling.',
        icon: BookOpen,
      },
      {
        label: 'Whitepaper',
        href: '/whitepaper',
        description: 'Technical specification.',
        icon: BookOpen,
      },
    ],
  },
  {
    label: 'Community',
    href: '/blog',
    items: [
      {
        label: 'Blog',
        href: '/blog',
        description: 'Engineering notes and release updates.',
        icon: BookOpen,
      },
      {
        label: 'Roadmap',
        href: '/roadmap',
        description: 'What is shipping next.',
        icon: LayoutGrid,
      },
      {
        label: 'GitHub',
        href: 'https://github.com/curiositech/port-daddy',
        description: 'Source, issues, and discussions.',
        icon: Github,
      },
    ],
  },
]

function DropdownItem({ item, onSelect }: { item: NavItem; onSelect: () => void }) {
  const Icon = item.icon ?? BookOpen
  const isExternal = item.href.startsWith('http')

  if (isExternal) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        className="block border-t border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-3)] no-underline first:border-t-0 hover:bg-[var(--interactive-hover)]"
        onClick={onSelect}
      >
        <div className="flex items-start gap-[var(--space-3)]">
          <Icon size={18} className="mt-[2px] text-[var(--brand-primary)]" />
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow className="text-[var(--text-primary)]">{item.label}</PanelEyebrow>
            {item.description ? (
              <p className="m-0 text-sm leading-[1.55] text-[var(--text-secondary)]">
                {item.description}
              </p>
            ) : null}
          </div>
        </div>
      </a>
    )
  }

  return (
    <Link
      to={item.href}
      className="block border-t border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-3)] no-underline first:border-t-0 hover:bg-[var(--interactive-hover)]"
      onClick={onSelect}
    >
      <div className="flex items-start gap-[var(--space-3)]">
        <Icon size={18} className="mt-[2px] text-[var(--brand-primary)]" />
        <div className="space-y-[var(--space-1)]">
          <PanelEyebrow className="text-[var(--text-primary)]">{item.label}</PanelEyebrow>
          {item.description ? (
            <p className="m-0 text-sm leading-[1.55] text-[var(--text-secondary)]">
              {item.description}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

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

  const scheduleClose = (delay = 140) => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false)
    }, delay)
  }

  React.useEffect(() => {
    return () => cancelClose()
  }, [])

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        cancelClose()
        setIsOpen(true)
      }}
      onMouseLeave={() => scheduleClose()}
      onFocus={() => {
        cancelClose()
        setIsOpen(true)
      }}
      onBlur={() => scheduleClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setIsOpen(false)
        }
      }}
    >
      <Link
        to={section.href}
        className={`inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center gap-[var(--space-1)] border-b-2 px-0 py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] no-underline transition-colors ${
          isActive
            ? 'border-[var(--border-strong)] text-[var(--text-primary)]'
            : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
        }`}
      >
        {section.label}
        {section.items ? (
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        ) : null}
      </Link>

      {section.items && isOpen ? (
        <div className="absolute left-0 top-full z-50 w-[19rem] pt-[var(--space-2)]">
          <SurfacePanel padding="compact" className="space-y-0">
            {section.items.map((item) => (
              <DropdownItem key={item.label} item={item} onSelect={() => setIsOpen(false)} />
            ))}
          </SurfacePanel>
        </div>
      ) : null}
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
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:border-2 focus:border-[var(--border-strong)] focus:bg-[var(--brand-primary)] focus:px-4 focus:py-2 focus:font-semibold focus:text-[var(--text-inverse)]"
      >
        Skip to main content
      </a>

      <nav
        className={`fixed left-0 right-0 top-0 z-[100] border-b-2 border-[var(--border-strong)] transition-colors duration-300 ${
          scrolled ? 'bg-[color:var(--surface-overlay)] backdrop-blur-md' : 'bg-[color:var(--surface-overlay)]'
        }`}
      >
        <PageContainer width="wide">
          <div className="flex min-h-[76px] items-center justify-between gap-[var(--space-4)]">
            <Link to="/" className="flex items-center gap-[var(--space-3)] no-underline">
              <BrandWordmark title="Port Daddy" subtitle="Single-daemon control plane" />
            </Link>

            <div className="hidden items-center gap-[var(--space-4)] lg:flex">
              <Link
                to="/"
                className={`inline-flex min-h-[calc(var(--space-6)+var(--space-1))] items-center border-b-2 px-0 py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] no-underline transition-colors ${
                  location.pathname === '/'
                    ? 'border-[var(--border-strong)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
                }`}
              >
                Home
              </Link>
              {NAV_STRUCTURE.map((section) => (
                <DropdownNav key={section.label} section={section} />
              ))}
            </div>

            <div className="flex items-center gap-[var(--space-2)]">
              <div className="hidden md:block">
                <DocsSearch variant="compact" />
              </div>

              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="md:hidden"
                onClick={openDocsSearch}
                aria-label="Search documentation"
              >
                <BookOpen size={16} />
              </Button>

              <Button type="button" variant="secondary" size="icon" onClick={toggle} aria-label="Toggle theme">
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </Button>

              <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                <a href="https://github.com/curiositech/port-daddy" target="_blank" rel="noopener noreferrer">
                  <Github size={16} />
                  Star
                </a>
              </Button>

              <Button asChild variant="primary" size="sm" className="hidden sm:inline-flex">
                <Link to="/tutorials/getting-started">Get Started</Link>
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileOpen((open) => !open)}
                aria-label="Toggle menu"
                aria-expanded={mobileOpen}
                aria-controls="site-mobile-menu"
              >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
              </Button>
            </div>
          </div>
        </PageContainer>

        {mobileOpen ? (
          <div
            id="site-mobile-menu"
            className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] lg:hidden"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMobileOpen(false)
            }}
          >
            <PageContainer width="wide" className="space-y-[var(--space-6)] py-[var(--space-5)]">
              <div className="space-y-[var(--space-3)]">
                <Link
                  to="/"
                  className="block border-b-2 border-[var(--border-default)] pb-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] no-underline"
                  onClick={() => setMobileOpen(false)}
                >
                  Home
                </Link>
                {NAV_STRUCTURE.map((section) => (
                  <div key={section.label} className="space-y-[var(--space-2)] border-b-2 border-[var(--border-default)] pb-[var(--space-3)]">
                    <Link
                      to={section.href}
                      className="block font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] no-underline"
                      onClick={() => setMobileOpen(false)}
                    >
                      {section.label}
                    </Link>
                    {section.items ? (
                      <div className="space-y-[var(--space-2)]">
                        {section.items.map((item) => {
                          const isExternal = item.href.startsWith('http')

                          if (isExternal) {
                            return (
                              <a
                                key={item.label}
                                href={item.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block py-[var(--space-2)] text-sm leading-[1.55] text-[var(--text-secondary)] no-underline"
                                onClick={() => setMobileOpen(false)}
                              >
                                {item.label}
                              </a>
                            )
                          }

                          return (
                            <Link
                              key={item.label}
                              to={item.href}
                              className="block py-[var(--space-2)] text-sm leading-[1.55] text-[var(--text-secondary)] no-underline"
                              onClick={() => setMobileOpen(false)}
                            >
                              {item.label}
                            </Link>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <Button asChild variant="primary" size="lg" className="w-full">
                <Link to="/tutorials/getting-started" onClick={() => setMobileOpen(false)}>
                  Get Started
                </Link>
              </Button>
            </PageContainer>
          </div>
        ) : null}
      </nav>
    </>
  )
}
