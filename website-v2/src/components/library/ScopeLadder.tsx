import { Cpu, Bot, Eye, Store, ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The scope ladder — the small idea and the big idea in one figure, and the four
 * layers of ADR-0048 told as widening scope. The four panels ARE L0→L3: the
 * machine the daemon governs, the swarm it coordinates, the operator who reads
 * it, and the market it grows into. Each carries a real build state and an ETA,
 * never a mood word.
 *
 * Themed entirely through `var(--token)` so it switches light/dark with the page
 * by construction. All text ≥13px; layer codes are uppercase + tracked. Two
 * layouts: default reads left-to-right on wide screens and stacks on narrow;
 * `compact` tightens it for hero use.
 */

type Stage = 'shipped' | 'building' | 'specified'

interface Layer {
  icon: LucideIcon
  /** The layer code from ADR-0048. */
  code: string
  /** The scope this layer governs, in the reader's words. */
  scope: string
  /** Who it is for — the load-bearing column from ADR-0048. */
  whom: string
  /** The one thing Port Daddy does at this layer. */
  does: string
  stage: Stage
  /** A concrete build state + date. Never "horizon" or "soon". */
  eta: string
}

const LAYERS: Layer[] = [
  {
    icon: Cpu,
    code: 'L0',
    scope: 'Your machine',
    whom: 'the daemon',
    does: 'A local daemon decides what is true — one writer, one durable file, no consensus.',
    stage: 'shipped',
    eta: 'Shipped',
  },
  {
    icon: Bot,
    code: 'L1',
    scope: 'Your swarm',
    whom: 'the agents',
    does: 'Agents claim before they touch, so the second one to reach a file waits instead of clobbering it.',
    stage: 'shipped',
    eta: 'Shipped',
  },
  {
    icon: Eye,
    code: 'L2',
    scope: 'Your cockpit',
    whom: 'the operator',
    does: 'The whole swarm as one picture you zoom into — down to the real diff, never a wall of them.',
    stage: 'building',
    eta: 'In progress · 2026',
  },
  {
    icon: Store,
    code: 'L3',
    scope: 'The market',
    whom: 'operators who never met',
    does: 'Rent a trustworthy agent across machines, settled on one ledger that cannot lose your money.',
    stage: 'specified',
    eta: 'Specified · 2027',
  },
]

const STAGE_STYLE: Record<Stage, { fg: string; border: string; bg: string }> = {
  shipped: {
    fg: 'var(--brand-primary)',
    border: 'var(--brand-primary)',
    bg: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)',
  },
  building: {
    fg: 'var(--brand-accent)',
    border: 'var(--brand-accent)',
    bg: 'color-mix(in srgb, var(--brand-accent) 8%, transparent)',
  },
  specified: {
    fg: 'var(--text-muted)',
    border: 'var(--border-default)',
    bg: 'transparent',
  },
}

function EtaTag({ stage, eta }: { stage: Stage; eta: string }) {
  const s = STAGE_STYLE[stage]
  return (
    <span
      className="inline-flex items-center border px-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]"
      style={{ color: s.fg, borderColor: s.border, background: s.bg }}
    >
      {eta}
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
        {LAYERS.map((layer, index) => {
          const Icon = layer.icon
          const s = STAGE_STYLE[layer.stage]
          return (
            <li key={layer.code} className="contents">
              <div className="grid content-start gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
                <div className="flex items-center justify-between gap-[var(--space-2)]">
                  <span
                    aria-hidden="true"
                    className="grid h-[2.25rem] w-[2.25rem] place-items-center border-2 border-[var(--border-strong)]"
                    style={{
                      background: layer.stage === 'shipped' ? 'var(--brand-primary)' : 'var(--surface-base)',
                      color: layer.stage === 'shipped' ? 'var(--brand-primary-foreground)' : s.fg,
                    }}
                  >
                    <Icon size={18} strokeWidth={2.25} />
                  </span>
                  <span className="font-mono text-[length:var(--text-sm)] font-black text-[var(--brand-primary)]">
                    {layer.code}
                  </span>
                </div>
                <div className="space-y-[var(--space-1)]">
                  <p className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                    {layer.scope}
                  </p>
                  <p className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    for {layer.whom}
                  </p>
                </div>
                <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {layer.does}
                </p>
                <div className="pt-[var(--space-1)]">
                  <EtaTag stage={layer.stage} eta={layer.eta} />
                </div>
              </div>
              {/* The widening arrow between layers — only in the wide ladder. */}
              {!compact && index < LAYERS.length - 1 ? (
                <div aria-hidden="true" className="hidden items-center justify-center self-center text-[var(--brand-primary)] lg:flex">
                  <ArrowRight size={20} strokeWidth={2.5} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Four layers, one widening scope. The daemon and the swarm coordination run
        today. The operator&rsquo;s cockpit is the work of 2026. The cross-machine
        market is specified in the papers and targeted for 2027 — dated, not
        promised.
      </figcaption>
    </figure>
  )
}
