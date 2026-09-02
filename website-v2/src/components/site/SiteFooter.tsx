import { Link } from 'react-router-dom'
import { Github } from 'lucide-react'
import { Wordmark } from './primitives'

const SITE_LINKS = [
  { label: 'Home', href: '/' },
  { label: 'Mac Preview', href: '/mac-preview' },
  { label: 'Examples', href: '/examples' },
  { label: 'Agents', href: '/agents' },
  { label: 'Install & MCP', href: '/mac-preview' },
  { label: 'Manifesto', href: '/manifesto' },
] as const

const LEARN_LINKS = [
  { label: 'Docs', href: '/docs' },
  { label: 'Tutorials', href: '/tutorials' },
  { label: 'Templates', href: '/agents/templates' },
  { label: 'Harbor Blog', href: '/blog' },
] as const

const REFERENCE_LINKS = [
  { label: 'Getting started', href: '/docs/quickstart' },
  { label: 'CLI reference', href: '/docs/cli' },
  { label: 'SDK reference', href: '/docs/sdk' },
  { label: 'MCP tools', href: '/docs/mcp' },
  { label: 'REST API', href: '/docs/api' },
  { label: 'Library', href: '/library' },
] as const

export function SiteFooter() {
  return (
    <footer className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-strong)]">
      <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-[var(--space-6)] px-[var(--space-5)] py-[var(--space-6)] lg:grid-cols-12 lg:px-[var(--space-6)]">
        <div className="space-y-[var(--space-4)] lg:col-span-5">
          {/* Full wordmark lockup — mark + "Port Daddy" + tagline rule. */}
          <Wordmark variant="full" className="h-auto w-full max-w-[20rem]" />
          <p className="max-w-[34rem] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            Port Daddy is shared memory for AI coding agents — the notes they leave each other, the
            files each one has claimed, and the work you can recover when one crashes. The Mac app
            makes all of it visible before anything drifts.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-[var(--space-5)] lg:col-span-7 lg:grid-cols-4">
          <div className="space-y-[var(--space-3)]">
            <div className="font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              Site
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              {SITE_LINKS.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="text-[length:var(--type-meta-size)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-[var(--space-3)]">
            <div className="font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              Learn
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              {LEARN_LINKS.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="text-[length:var(--type-meta-size)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-[var(--space-3)]">
            <div className="font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              Reference
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              {REFERENCE_LINKS.map((link) => (
                <Link
                  key={link.label}
                  to={link.href}
                  className="text-[length:var(--type-meta-size)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="space-y-[var(--space-3)]">
            <div className="font-sans text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              Source
            </div>
            <div className="flex flex-col gap-[var(--space-2)]">
              <a
                href="https://github.com/curiositech/port-daddy"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-[var(--space-2)] text-[length:var(--type-meta-size)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
              >
                <Github size={15} />
                GitHub
              </a>
              <a
                href="https://github.com/curiositech/port-daddy/discussions"
                target="_blank"
                rel="noreferrer"
                className="text-[length:var(--type-meta-size)] text-[var(--text-primary)] hover:text-[var(--brand-primary)]"
              >
                Discussions
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
