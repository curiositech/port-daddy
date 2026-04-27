import { Link, NavLink } from 'react-router-dom'
import { Github, Moon, Search, Sun } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DocsSearch } from '@/components/docs/DocsSearch'
import { openDocsSearch } from '@/components/docs/docsSearchEvents'
import { useTheme } from '@/lib/theme-context'
import { BrandMark, PageContainer } from './primitives'

const NAV_ITEMS = [
  { label: 'Docs', href: '/docs', end: false },
  { label: 'Dashboard', href: '/dashboard', end: false },
  { label: 'Examples', href: '/examples', end: false },
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
        className="sr-only bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] focus:not-sr-only focus:fixed focus:left-[var(--space-4)] focus:top-[var(--space-4)] focus:z-[200] focus:border-2 focus:border-[var(--border-strong)] focus:px-[var(--space-4)] focus:py-[var(--space-2)] focus:font-sans focus:text-[length:var(--type-meta-size)] focus:font-semibold focus:uppercase focus:tracking-[var(--tracking-meta)] focus:outline focus:outline-2 focus:outline-offset-3 focus:outline-[var(--interactive-focus)]"
      >
        Skip to main content
      </a>
      <header
        data-shell="site-header"
        className="sticky top-0 z-50 border-b-2 border-[var(--border-strong)] bg-[var(--surface-base)] relative"
      >
        <PageContainer width="wide" className="!max-w-none flex items-center justify-between gap-[var(--space-5)] py-[var(--space-4)]">
          <Link to="/" className="inline-flex min-w-0 items-center gap-[var(--space-3)] text-[var(--text-primary)]">
            <BrandMark />
            <div className="flex min-w-0 flex-col">
              <span className="font-display text-[length:var(--text-lg)] font-black uppercase leading-none tracking-[var(--tracking-display-nav)]">
                Port Daddy
              </span>
              <span className="hidden max-w-[34ch] truncate font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] sm:block">
                control plane docs and live surfaces
              </span>
            </div>
          </Link>

          <div className="flex min-w-0 items-center gap-[var(--space-2)] sm:gap-[var(--space-3)]">
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
                      'inline-flex shrink-0 items-center border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]',
                      isActive
                        ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                        : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]',
                    ].join(' ')
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <div className="hidden min-w-[12rem] md:block">
              <DocsSearch variant="compact" />
            </div>

            <button
              type="button"
              onClick={openDocsSearch}
              className="inline-flex border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] md:hidden"
              aria-label="Search documentation"
            >
              <Search size={16} />
            </button>

            <a
              href="https://github.com/curiositech/port-daddy"
              target="_blank"
              rel="noreferrer"
              className="hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-2)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)] sm:inline-flex"
              aria-label="Open GitHub repository"
            >
              <Github size={16} />
            </a>

            <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-label="Toggle color theme">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </Button>
          </div>
        </PageContainer>

        <nav
          aria-label="Mobile primary"
          className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] lg:hidden"
        >
          <PageContainer width="wide" className="!max-w-none flex gap-[var(--space-2)] overflow-x-auto py-[var(--space-2)]">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={`mobile-${item.href}`}
                to={item.href}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'inline-flex shrink-0 items-center border-2 px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]',
                    isActive
                      ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-base)] hover:text-[var(--text-primary)]',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </PageContainer>
        </nav>
      </header>
    </>
  )
}
