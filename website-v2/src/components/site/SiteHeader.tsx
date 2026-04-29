import { Link, NavLink } from 'react-router-dom'
import { Github, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTheme } from '@/lib/theme'
import { BrandWordmark } from './primitives'

const NAV_ITEMS = [
  { label: 'Docs', href: '/docs', end: false },
  { label: 'Examples', href: '/docs/examples', end: false },
  { label: 'MCP', href: '/mcp', end: false },
  { label: 'Tutorials', href: '/tutorials', end: false },
  { label: 'Roadmap', href: '/roadmap', end: false },
  { label: 'Whitepaper', href: '/whitepaper', end: false },
] as const

export function SiteHeader() {
  const { theme, toggle } = useTheme()

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-[var(--brand-primary)] focus:px-4 focus:py-2 focus:font-medium focus:text-[var(--text-inverse)]"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-50 border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] relative">
        <div className="absolute right-0 top-0 h-full w-3 bg-[var(--brand-accent)]" />
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-[var(--space-5)] px-[var(--space-5)] py-[var(--space-4)] lg:px-[var(--space-6)]">
          <Link to="/" className="inline-flex items-center text-[var(--text-primary)]">
            <BrandWordmark title="Port Daddy" subtitle="control plane docs and live surfaces" />
          </Link>

          <div className="flex items-center gap-[var(--space-2)] sm:gap-[var(--space-3)]">
            <nav
              aria-label="Primary"
              className="hidden items-center gap-[var(--space-2)] overflow-x-auto lg:flex"
            >
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.href}
                  to={item.href}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      'inline-flex items-center border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] transition-colors',
                      isActive
                        ? 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className="hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] sm:inline-flex"
              aria-label="Open GitHub repository"
            >
              <Github size={16} />
            </a>

            <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-label="Toggle color theme">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </Button>
          </div>
        </div>

        <nav
          aria-label="Mobile primary"
          className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] lg:hidden"
        >
          <div className="mx-auto flex max-w-[1440px] gap-[var(--space-2)] overflow-x-auto px-[var(--space-5)] py-[var(--space-2)] lg:px-[var(--space-6)]">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={`mobile-${item.href}`}
                to={item.href}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'inline-flex shrink-0 items-center border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] transition-colors',
                    isActive
                      ? 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>
    </>
  )
}
