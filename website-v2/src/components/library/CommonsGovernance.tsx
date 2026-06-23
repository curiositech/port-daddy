/**
 * Ostrom's eight design principles for governing a commons (Cryptography §5),
 * arranged as a ring around the daemon at the center. A swarm shares scarce
 * things — ports, files, the single source of truth about what is claimed — and
 * Port Daddy governs that commons the way Elinor Ostrom documented in commons
 * that actually survive, rather than by installing a Leviathan.
 *
 * Principle 5, Graduated Sanctions, is highlighted and wired to the bond-slash
 * callout: a first lapse is a nudge, repeated breaches cost progressively more,
 * capped so a penalty never seizes the whole bond.
 *
 * Every color is a CSS custom property so the figure tracks the page theme via
 * the `[data-theme]` cascade with no JS. All `<text>` is ≥13px; the principle
 * numbers are bold mono, the labels are sans, the center label is uppercase
 * tracked meta text.
 */

import React from 'react'

interface Principle {
  n: number
  label: string
  /** Highlighted (the one wired to the bond slash). */
  emphasis?: boolean
}

// Ostrom's canonical eight, in order.
const PRINCIPLES: Principle[] = [
  { n: 1, label: 'Clear boundaries' },
  { n: 2, label: 'Proportional cost/benefit' },
  { n: 3, label: 'Collective-choice rules' },
  { n: 4, label: 'Monitoring by the governed' },
  { n: 5, label: 'Graduated sanctions', emphasis: true },
  { n: 6, label: 'Cheap conflict resolution' },
  { n: 7, label: 'Right to self-organize' },
  { n: 8, label: 'Nested enterprises' },
]

const CX = 250
const CY = 196
const R = 132 // ring radius for the principle nodes

export function CommonsGovernance() {
  const uid = React.useId()
  const titleId = `${uid}-cg-title`
  const descId = `${uid}-cg-desc`
  const arrowId = `${uid}-cg-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 680 444"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[36rem] max-w-[48rem]"
        >
          <title id={titleId}>Ostrom's eight commons-governance principles as a ring around the daemon</title>
          <desc id={descId}>
            Eight numbered principles arranged in a ring around the Port Daddy
            daemon at the center, with a numbered key to the right: clear
            boundaries, proportional cost and benefit, collective-choice rules,
            monitoring by the governed, graduated sanctions (highlighted), cheap
            conflict resolution, the right to self-organize, and nested
            enterprises. Principle five is wired to a bond-slash callout
            describing proportionate, capped penalties.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-accent)" />
            </marker>
          </defs>

          {/* The ring track. */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--border-default)" strokeWidth="2" strokeDasharray="3 6" />

          {/* The daemon core. */}
          <circle cx={CX} cy={CY} r="52" fill="var(--brand-primary)" stroke="var(--border-strong)" strokeWidth="2" />
          <text x={CX} y={CY - 4} textAnchor="middle" fill="var(--brand-primary-foreground)" style={{ font: '900 16px var(--font-display)' }}>
            daemon
          </text>
          <text x={CX} y={CY + 16} textAnchor="middle" fill="var(--brand-primary-foreground)" style={{ font: '700 13px var(--font-sans)', letterSpacing: '0.04em' }}>
            the commons
          </text>

          {/* Eight numbered principle nodes around the ring (labels live in the
              key to the right, so nothing overflows the figure). */}
          {PRINCIPLES.map((p, i) => {
            const angle = (-90 + i * 45) * (Math.PI / 180)
            const x = CX + R * Math.cos(angle)
            const y = CY + R * Math.sin(angle)
            return (
              <g key={p.n}>
                <circle
                  cx={x}
                  cy={y}
                  r="20"
                  fill={p.emphasis ? 'var(--brand-accent)' : 'var(--surface-raised)'}
                  stroke={p.emphasis ? 'var(--brand-accent)' : 'var(--border-strong)'}
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={p.emphasis ? 'var(--brand-accent-foreground)' : 'var(--text-primary)'}
                  style={{ font: '900 16px var(--font-mono)' }}
                >
                  {p.n}
                </text>
              </g>
            )
          })}

          {/* Numbered key, to the right of the ring. */}
          <g transform="translate(440, 56)">
            {PRINCIPLES.map((p, i) => (
              <g key={`key-${p.n}`} transform={`translate(0, ${i * 26})`}>
                <text x="0" y="0" fill={p.emphasis ? 'var(--brand-accent)' : 'var(--text-muted)'} style={{ font: '900 14px var(--font-mono)' }}>
                  {p.n}
                </text>
                <text x="22" y="0" fill={p.emphasis ? 'var(--brand-accent)' : 'var(--text-secondary)'} style={{ font: p.emphasis ? '800 14px var(--font-sans)' : '600 14px var(--font-sans)' }}>
                  {p.label}
                </text>
              </g>
            ))}
          </g>

          {/* Bond-slash callout below the ring, wired from principle 5 (bottom). */}
          <g transform="translate(110, 320)">
            <rect width="500" height="104" rx="6" fill="var(--surface-base)" stroke="var(--brand-accent)" strokeWidth="2" />
            <text x="20" y="28" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
              PRINCIPLE 5 — GRADUATED SANCTIONS → BOND SLASH
            </text>
            <text x="20" y="54" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>1st lapse · a nudge</text>
            <text x="20" y="78" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>repeat · costs progressively more</text>
            <text x="270" y="78" fill="var(--text-primary)" style={{ font: '600 14px var(--font-sans)' }}>capped · never seizes the whole bond</text>
          </g>
          {/* principle 5 (bottom of ring) → callout connector. */}
          <line x1={CX} y1={CY + R + 20} x2={CX} y2="320" stroke="var(--brand-accent)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        Graduated sanctions, <span className="font-black text-[var(--text-primary)]">advisory by default</span>.
        The daemon coordinates the commons; it does not rule it. Punishment is
        proportionate and capped, and it is the same rule for every actor, human
        or agent — Ostrom&rsquo;s design, not Hobbes&rsquo;s Leviathan.
      </figcaption>
    </figure>
  )
}
