/**
 * The L0 → L3 nesting diagram. The library's central claim, drawn — and the
 * exact stack from ADR-0048 ("What Port Daddy Is"): four layers, each a shell
 * around the one beneath it, each serving a different *whom*. The kernel serves
 * the machine and the agents; legibility serves the human operator (this is the
 * wedge that ships today); and the economy serves the market between operators
 * (specified in the papers, targeted for 2027).
 *
 * Every color is a CSS custom property (`var(--token)`), so the figure inherits
 * the page theme via the `[data-theme]` cascade — light and dark switch with no
 * JS and no duplicated palette. SVG `<text>` is sized in px ≥ 13 to satisfy the
 * legibility floor; the small layer codes (L0…L3) are uppercase, bold, and
 * tracked so they read larger than their nominal size.
 */

interface Shell {
  code: string
  /** Who this layer is for — the load-bearing column from ADR-0048. */
  whom: string
  title: string
  chapter: string
  /** Build state + ETA, in the reader's words. Never a mood word. */
  state: string
  /** Whether this is the shippable wedge (gets the brand highlight). */
  isWedge?: boolean
  /** The concrete thing this layer is, in the reader's words. */
  what: string
}

const SHELLS: Shell[] = [
  {
    code: 'L0 · L1',
    whom: 'the machine & the agents',
    title: 'The Single-Writer Kernel',
    chapter: 'II',
    state: 'Shipped',
    what: 'A daemon decides what is true. One writer, one durable file, no consensus.',
  },
  {
    code: 'L2',
    whom: 'the human operator',
    title: 'The Legible Swarm',
    chapter: 'I',
    state: 'The wedge · 2026',
    isWedge: true,
    what: 'You see the whole swarm as one picture, and zoom to the real artifact.',
  },
  {
    code: 'L3 bridge',
    whom: 'a track record',
    title: 'From Spawn to Person',
    chapter: 'III',
    state: 'In progress · 2026',
    what: 'Continuity turns an anonymous spawn into someone with a reputation.',
  },
  {
    code: 'L3',
    whom: 'the market between operators',
    title: 'The Harbor Economy',
    chapter: 'IV',
    state: 'Specified · 2027',
    what: 'A market between people who never met, settling on one conserving ledger.',
  },
]

export function NestingDiagram() {
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="grid gap-[var(--space-5)] p-[var(--space-5)] lg:grid-cols-[minmax(0,0.46fr)_minmax(0,0.54fr)] lg:items-center lg:gap-[var(--space-6)]">
        {/* The nested shells, drawn. */}
        <svg
          viewBox="0 0 360 360"
          role="img"
          aria-labelledby="nesting-title nesting-desc"
          className="mx-auto block w-full max-w-[24rem]"
        >
          <title id="nesting-title">The four layers, drawn as nested shells</title>
          <desc id="nesting-desc">
            Four concentric rounded rectangles. The innermost is the single-writer
            kernel on one machine; around it, the legible swarm for one operator;
            around that, the bridge that gives an agent a continuous identity; and
            the outermost shell is the economy between many operators.
          </desc>

          {/* Outermost → innermost so inner shells paint on top. */}
          {/* L3 — the economy (outermost) */}
          <rect x="6" y="6" width="348" height="348" rx="14" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
          <rect x="6" y="6" width="348" height="348" rx="14" fill="var(--brand-primary)" opacity="0.06" />
          {/* L3 bridge */}
          <rect x="48" y="48" width="264" height="264" rx="12" fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth="2" />
          {/* L2 — legibility */}
          <rect x="90" y="90" width="180" height="180" rx="10" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
          {/* L0/L1 — kernel (innermost, filled brand) */}
          <rect x="132" y="132" width="96" height="96" rx="8" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />

          {/* Layer codes, top-left of each shell, uppercase + tracked. */}
          <g style={{ font: '700 13px var(--font-sans)', letterSpacing: '0.08em' }} textAnchor="start">
            <text x="18" y="28" fill="var(--text-primary)">L3 · MARKET</text>
            <text x="60" y="70" fill="var(--text-primary)">L3 · BRIDGE</text>
            <text x="102" y="112" fill="var(--text-primary)">L2 · SWARM</text>
          </g>
          {/* Kernel label sits inside the filled core, inverse ink. */}
          <text x="180" y="176" textAnchor="middle" fill="var(--brand-primary-foreground)" style={{ font: '700 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            L0 · L1
          </text>
          <text x="180" y="192" textAnchor="middle" fill="var(--brand-primary-foreground)" style={{ font: '600 13px var(--font-sans)' }}>
            kernel
          </text>
        </svg>

        {/* The same four shells, as a read-down legend keyed by chapter. */}
        <ol className="grid gap-[var(--space-2)]">
          {SHELLS.map((shell) => (
            <li
              key={shell.code}
              className="grid grid-cols-[auto,1fr] items-baseline gap-x-[var(--space-3)] gap-y-[var(--space-1)] border-2 border-[var(--border-default)] bg-[var(--surface-raised)] p-[var(--space-3)]"
            >
              <span
                aria-hidden="true"
                className="grid h-[1.75rem] w-[1.75rem] place-items-center border-2 border-[var(--border-strong)] font-mono text-[length:var(--text-sm)] font-black leading-none"
                style={{
                  background: shell.isWedge ? 'var(--brand-primary)' : 'var(--surface-base)',
                  color: shell.isWedge ? 'var(--brand-primary-foreground)' : 'var(--text-primary)',
                }}
              >
                {shell.chapter}
              </span>
              <div className="min-w-0 space-y-[var(--space-1)]">
                <div className="flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-[var(--space-1)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    {shell.code}
                  </span>
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    for {shell.whom}
                  </span>
                  <span
                    className="inline-flex items-center border border-[var(--border-default)] px-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]"
                    style={{
                      color: shell.isWedge ? 'var(--brand-primary)' : 'var(--text-muted)',
                      borderColor: shell.isWedge ? 'var(--brand-primary)' : 'var(--border-default)',
                    }}
                  >
                    {shell.state}
                  </span>
                </div>
                <p className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                  {shell.title}
                </p>
                <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  {shell.what}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Four layers, each a shell around the one beneath it, each for a different
        <span className="font-black text-[var(--text-primary)]"> whom</span>: the
        kernel for the machine, legibility for the operator, the economy for the
        market between operators. The middle shell —{' '}
        <span className="font-black text-[var(--text-primary)]">legibility, the wedge</span>{' '}
        — is the product a solo developer pays for today. The economy is
        specified in the papers and targeted for 2027. Pull out an inner shell
        and every shell outside it collapses.
      </figcaption>
    </figure>
  )
}
