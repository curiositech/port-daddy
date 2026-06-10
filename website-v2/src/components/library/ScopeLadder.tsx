import { GitBranch, Cpu, Network, Store, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The scope ladder — the small idea and the big idea in one figure. Port Daddy
 * governs a widening scope: it starts inside one repo, grows to the whole
 * machine, reaches across the network to other operators, and lands on an
 * agentic economy. This is ADR-0048's L0→L3 stack told as *scope*, the version
 * a first-time reader gets in one glance.
 *
 * Themed entirely through `var(--token)` so it switches light/dark with the
 * page by construction. All text ≥13px; scope codes are uppercase + tracked.
 * Two layouts: the default reads as a left-to-right ladder on wide screens and
 * stacks on narrow; `compact` drops the long descriptions for hero use.
 */

interface Scope {
  icon: LucideIcon
  /** The widening unit Port Daddy governs, in the reader's words. */
  scope: string
  /** The layer code from ADR-0048. */
  code: string
  /** The one thing Port Daddy does at this scope. */
  does: string
  /** Build state: shipped today, or the horizon. */
  state: 'now' | 'soon'
  /** A concrete primitive/command, for the non-compact layout. */
  primitive: string
}

const SCOPES: Scope[] = [
  {
    icon: GitBranch,
    scope: 'Your repo',
    code: 'L0 · L1',
    does: 'One writer at a time. No two agents clobber the same file.',
    state: 'now',
    primitive: 'claims · sessions · locks',
  },
  {
    icon: Cpu,
    scope: 'Your computer',
    code: 'L2',
    does: 'The whole swarm as one picture you can zoom into — never a wall of diffs.',
    state: 'now',
    primitive: 'legibility · attention · review',
  },
  {
    icon: Network,
    scope: 'The network',
    code: 'L3 federation',
    does: 'Your fleet and someone else’s co-work across machines, no shared blockchain.',
    state: 'soon',
    primitive: 'capability transfer · revocation',
  },
  {
    icon: Store,
    scope: 'The economy',
    code: 'L3 market',
    does: 'Rent a trustworthy agent from someone you never met, settled on one ledger.',
    state: 'soon',
    primitive: 'reputation · escrow · bond ledger',
  },
]

function StateTag({ state }: { state: Scope['state'] }) {
  const isNow = state === 'now'
  return (
    <span
      className="inline-flex items-center border px-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]"
      style={{
        color: isNow ? 'var(--brand-primary)' : 'var(--text-muted)',
        borderColor: isNow ? 'var(--brand-primary)' : 'var(--border-default)',
        background: isNow ? 'color-mix(in srgb, var(--brand-primary) 8%, transparent)' : 'transparent',
      }}
    >
      {isNow ? 'works today' : 'the horizon'}
    </span>
  )
}

export function ScopeLadder({ compact = false }: { compact?: boolean }) {
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <ol
        className={
          compact
            ? 'grid gap-[var(--space-3)] p-[var(--space-4)] sm:grid-cols-2 lg:grid-cols-4'
            : 'grid items-stretch gap-[var(--space-3)] p-[var(--space-5)] lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]'
        }
      >
        {SCOPES.map((scopeItem, index) => {
          const Icon = scopeItem.icon
          return (
            <li key={scopeItem.scope} className="contents">
              <div className="grid content-start gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <div className="flex items-center justify-between gap-[var(--space-2)]">
                  <span
                    aria-hidden="true"
                    className="grid h-[2.25rem] w-[2.25rem] place-items-center border-2 border-[var(--border-strong)]"
                    style={{
                      background: scopeItem.state === 'now' ? 'var(--brand-primary)' : 'var(--surface-base)',
                      color: scopeItem.state === 'now' ? 'var(--brand-primary-foreground)' : 'var(--text-primary)',
                    }}
                  >
                    <Icon size={18} strokeWidth={2.25} />
                  </span>
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    {scopeItem.code}
                  </span>
                </div>
                <p className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                  {scopeItem.scope}
                </p>
                <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {scopeItem.does}
                </p>
                <div className="flex flex-wrap items-center gap-[var(--space-2)] pt-[var(--space-1)]">
                  <StateTag state={scopeItem.state} />
                  {!compact ? (
                    <span className="font-mono text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                      {scopeItem.primitive}
                    </span>
                  ) : null}
                </div>
              </div>
              {/* The widening arrow between scopes — only in the wide ladder. */}
              {!compact && index < SCOPES.length - 1 ? (
                <div aria-hidden="true" className="hidden items-center justify-center self-center text-[var(--brand-primary)] lg:flex">
                  <ArrowRight size={20} strokeWidth={2.5} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        One tool, a widening scope. It earns its place inside a single repo today
        — and the same authority grows, machine by machine, into a market for
        agent labor. <span className="font-black text-[var(--text-primary)]">The
        left two work now.</span> The right two are where it is heading.
      </figcaption>
    </figure>
  )
}
