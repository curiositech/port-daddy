/**
 * Ostrom's eight design principles for governing a commons (Cryptography §5),
 * mapped onto Port Daddy. A swarm shares scarce things — ports, files, the
 * single source of truth about what is claimed — and Port Daddy governs that
 * commons the way Elinor Ostrom documented in commons that actually survive,
 * rather than by installing a Leviathan.
 *
 * Drawn as a legible two-column list rather than a ring: each principle is a
 * numbered row with a plain-English gloss, so it reads top-to-bottom with no
 * cross-referencing. Principle 5, Graduated Sanctions, is highlighted and its
 * bond-slash detail sits directly beneath it.
 *
 * Rendered in themed HTML (not a fixed-viewBox SVG) so every line wraps and
 * scales with the page — all text is ≥14px; the eyebrow is uppercase/tracked.
 */

interface Principle {
  n: number
  label: string
  /** Plain-English gloss of how Port Daddy satisfies it. */
  gloss: string
  /** Highlighted (the one wired to the bond slash). */
  emphasis?: boolean
}

// Ostrom's canonical eight, in order, each glossed in Port Daddy's terms.
const PRINCIPLES: Principle[] = [
  { n: 1, label: 'Clear boundaries', gloss: 'Every claim, port, and session has a defined holder.' },
  { n: 2, label: 'Proportional cost & benefit', gloss: 'What you can do is scaled to the bond you post.' },
  { n: 3, label: 'Collective-choice rules', gloss: 'Rules of the road agents can read and reason about.' },
  { n: 4, label: 'Monitoring by the governed', gloss: 'Immutable notes and activity any agent can audit.' },
  { n: 5, label: 'Graduated sanctions', gloss: 'Penalties escalate one rung at a time — and are capped.', emphasis: true },
  { n: 6, label: 'Cheap conflict resolution', gloss: 'The daemon settles port and claim conflicts atomically.' },
  { n: 7, label: 'Right to self-organize', gloss: 'Agents form sessions and channels without a gatekeeper.' },
  { n: 8, label: 'Nested enterprises', gloss: 'Local rules nest inside harbor- and fleet-wide ones.' },
]

function PrincipleRow({ p }: { p: Principle }) {
  return (
    <li
      className="grid grid-cols-[auto,1fr] items-start gap-x-[var(--space-3)] border-2 p-[var(--space-3)]"
      style={{
        borderColor: p.emphasis ? 'var(--brand-accent)' : 'var(--border-default)',
        background: p.emphasis ? 'color-mix(in oklab, var(--brand-accent) 10%, var(--surface-base))' : 'var(--surface-base)',
      }}
    >
      <span
        aria-hidden="true"
        className="grid h-[1.875rem] w-[1.875rem] place-items-center border-2 font-mono text-[length:var(--text-base)] font-black leading-none"
        style={{
          background: p.emphasis ? 'var(--brand-accent)' : 'var(--surface-raised)',
          color: p.emphasis ? 'var(--brand-accent-foreground)' : 'var(--text-primary)',
          borderColor: p.emphasis ? 'var(--brand-accent)' : 'var(--border-strong)',
        }}
      >
        {p.n}
      </span>
      <div className="min-w-0 space-y-[var(--space-1)]">
        <p
          className="font-sans text-[length:var(--text-base)] font-black leading-[var(--leading-nav)]"
          style={{ color: p.emphasis ? 'var(--brand-accent)' : 'var(--text-primary)' }}
        >
          {p.label}
        </p>
        <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          {p.gloss}
        </p>
      </div>
    </li>
  )
}

export function CommonsGovernance() {
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="grid gap-[var(--space-5)] p-[var(--space-5)]">
        {/* Header: the daemon coordinates the commons. */}
        <div className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-[var(--space-2)] border-b-2 border-[var(--border-default)] pb-[var(--space-4)]">
          <span className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="font-display text-[length:var(--text-lg)] font-black leading-none text-[var(--brand-primary-foreground)]">
              daemon
            </span>
            <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary-foreground)]">
              coordinates the commons
            </span>
          </span>
          <p className="min-w-0 flex-1 text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            Eight principles Elinor Ostrom found in commons that survive &mdash;
            each mapped to how Port Daddy governs shared ports, files, and truth.
          </p>
        </div>

        {/* The eight principles, two columns on wide screens. */}
        <ol className="grid gap-[var(--space-2)] sm:grid-cols-2">
          {PRINCIPLES.map((p) => (
            <PrincipleRow key={p.n} p={p} />
          ))}
        </ol>

        {/* Principle 5, expanded into the bond-slash ladder it drives. */}
        <div className="border-2 border-[var(--brand-accent)] bg-[var(--surface-base)] p-[var(--space-4)]">
          <p className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-accent)]">
            Principle 5 in action &mdash; graduated sanctions &rarr; bond slash
          </p>
          <div className="mt-[var(--space-3)] grid gap-[var(--space-2)] sm:grid-cols-3">
            <div className="border border-[var(--border-default)] p-[var(--space-3)]">
              <p className="font-sans text-[length:var(--text-base)] font-black text-[var(--text-primary)]">1st lapse</p>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">a nudge, no access change</p>
            </div>
            <div className="border border-[var(--border-default)] p-[var(--space-3)]">
              <p className="font-sans text-[length:var(--text-base)] font-black text-[var(--text-primary)]">repeat</p>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">costs progressively more</p>
            </div>
            <div className="border border-[var(--border-default)] p-[var(--space-3)]">
              <p className="font-sans text-[length:var(--text-base)] font-black text-[var(--text-primary)]">capped</p>
              <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">never seizes the whole bond</p>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Graduated sanctions, <span className="font-black text-[var(--text-primary)]">advisory by default</span>.
        The daemon coordinates the commons; it does not rule it. Punishment is
        proportionate and capped, and it is the same rule for every actor, human
        or agent &mdash; Ostrom&rsquo;s design, not Hobbes&rsquo;s Leviathan.
      </figcaption>
    </figure>
  )
}
