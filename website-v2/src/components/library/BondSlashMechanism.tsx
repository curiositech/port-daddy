/**
 * The graduated-sanction ladder (Cryptography §5 detail). Ostrom's Principle 5,
 * made concrete: a misbehaving agent is not banned on the first slip. Penalties
 * escalate one rung at a time, each proportionate to the pattern, and the whole
 * ladder is capped so a sanction can never seize the entire bond. Good behavior
 * walks the agent back down.
 *
 *   1. REPUTATION MARK  — logged, no access change
 *   2. ATTENUATION      — reduced capability scope
 *   3. RATE LIMITING    — slower resource allocation
 *   4. BOND SLASH        — partial, capped — never the whole bond
 *
 * Drawn as a four-rung ladder climbing left-to-right, severity rising, with a
 * cap line above the top rung and a "recovers downward" return arrow.
 *
 * Theme-aware via `var(--token)`; all `<text>` ≥14px except uppercase tracked
 * eyebrow/rung labels (≥600 weight).
 */

import React from 'react'

interface Rung {
  n: string
  label: string
  detail: string
  /** The top rung gets the danger accent. */
  severe?: boolean
}

const RUNGS: Rung[] = [
  { n: '1', label: 'Reputation mark', detail: 'logged · no change' },
  { n: '2', label: 'Attenuation', detail: 'less capability' },
  { n: '3', label: 'Rate limiting', detail: 'slower allocation' },
  { n: '4', label: 'Bond slash', detail: 'partial · capped', severe: true },
]

const STEP_W = 132
const STEP_GAP = 8
const BOX_H = 64 // fixed rung height so label + detail always fit
const BASE_Y = 256 // baseline the lowest rung sits on
const RISE = 30 // how much each successive rung's top climbs

export function BondSlashMechanism() {
  const uid = React.useId()
  const titleId = `${uid}-slash-title`
  const descId = `${uid}-slash-desc`
  const arrowId = `${uid}-slash-arrow`
  const xOf = (i: number) => 24 + i * (STEP_W + STEP_GAP)
  // Fixed-height boxes whose tops climb one rung at a time (a staircase).
  const topOf = (i: number) => BASE_Y - BOX_H - i * RISE
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 300"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>The graduated-sanction ladder, capped below total bond loss</title>
          <desc id={descId}>
            Four rungs climbing left to right with rising severity: first a
            reputation mark with no access change, then attenuation of capability
            scope, then rate limiting, then a partial, capped bond slash. A cap
            line sits above the top rung, and a return arrow shows that good
            behavior walks the penalty back down.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
            </marker>
          </defs>

          <text x="24" y="24" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
            ESCALATION RISES ONE RUNG AT A TIME →
          </text>

          {/* The cap line — sanctions never cross it (never the whole bond). */}
          <line x1="24" y1="48" x2="576" y2="48" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="4 4" />
          <text x="576" y="42" textAnchor="end" fill="var(--brand-accent)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.04em' }}>
            CAP — never the whole bond
          </text>

          {/* Four rungs. */}
          {/* Riser connectors under the staircase, drawn first. */}
          {RUNGS.slice(0, -1).map((_, i) => (
            <line
              key={`riser-${i}`}
              x1={xOf(i) + STEP_W}
              y1={topOf(i)}
              x2={xOf(i + 1)}
              y2={topOf(i) - RISE}
              stroke="var(--border-default)"
              strokeWidth="2"
            />
          ))}

          {RUNGS.map((r, i) => {
            const x = xOf(i)
            const top = topOf(i)
            return (
              <g key={r.n}>
                <rect
                  x={x}
                  y={top}
                  width={STEP_W}
                  height={BOX_H}
                  rx="6"
                  fill={r.severe ? 'var(--brand-accent)' : 'var(--surface-raised)'}
                  stroke={r.severe ? 'var(--brand-accent)' : 'var(--border-strong)'}
                  strokeWidth="2"
                />
                <text x={x + 12} y={top + 26} fill={r.severe ? 'var(--brand-accent-foreground)' : 'var(--brand-primary)'} style={{ font: '900 16px var(--font-mono)' }}>
                  {r.n}
                </text>
                <text x={x + 32} y={top + 26} fill={r.severe ? 'var(--brand-accent-foreground)' : 'var(--text-primary)'} style={{ font: '800 14px var(--font-sans)' }}>
                  {r.label}
                </text>
                <text x={x + 12} y={top + 48} fill={r.severe ? 'var(--brand-accent-foreground)' : 'var(--text-secondary)'} style={{ font: '500 14px var(--font-sans)' }}>
                  {r.detail}
                </text>
              </g>
            )
          })}

          {/* Recovery arrow: good behavior walks it back down. A flat arc in the
              open band between the cap line and the tallest rung, ending at the
              top of rung 1. Its label rides just below the arc apex. */}
          <path
            d={`M ${xOf(3) + STEP_W / 2} ${topOf(3) - 8} C ${xOf(3)} 72, ${xOf(1) + STEP_W} 72, ${xOf(0) + STEP_W / 2} ${topOf(0) - 8}`}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="2"
            strokeDasharray="5 4"
            markerEnd={`url(#${arrowId})`}
          />
          <text x={(xOf(0) + xOf(3) + STEP_W) / 2} y="88" textAnchor="middle" fill="var(--text-muted)" style={{ font: '600 14px var(--font-sans)' }}>
            good behavior recovers it downward
          </text>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        A first slip is a <span className="font-black text-[var(--text-primary)]">nudge</span>,
        not a guillotine. Penalties climb one rung at a time, each proportionate to
        the pattern, and the ladder is <span className="font-black text-[var(--text-primary)]">capped</span> &mdash;
        a sanction can never seize the whole bond. Behave again and the agent walks
        back down. The same rule applies to every actor, human or agent.
      </figcaption>
    </figure>
  )
}
