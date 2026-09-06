/**
 * A native, theme-aware rebuild of the Harbor Economy's three-sided-market
 * figure (Chapter 5, `fig-he-three-sided.tex`): three kinds of seller — labor,
 * rentable capital, licensed IP — all settling on one conserving bond ledger
 * through an escrow that can pay out or refuse, but provably cannot redirect.
 *
 * Drawn with `var(--token)` fills/strokes so it switches light/dark with the
 * page. All `<text>` is ≥13px; side labels are bold; sub-labels are tracked
 * meta text. This is the "what the future looks like" picture the library
 * arrives at.
 */

import React from 'react'

interface Side {
  n: string
  title: string
  what: string
  x: number
}

const SIDES: Side[] = [
  { n: 'Side 1', title: 'Labor', what: 'operator-for-hire', x: 90 },
  { n: 'Side 2', title: 'Capital', what: 'agent or fleet, rented', x: 300 },
  { n: 'Side 3', title: 'IP', what: 'skill or tool, licensed', x: 510 },
]

const BOX_W = 156
const BOX_H = 66

export function ThreeSidedMarket() {
  const uid = React.useId()
  const titleId = `${uid}-market-title`
  const descId = `${uid}-market-desc`
  const arrowId = `${uid}-flow-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 600 320"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[46rem]"
        >
          <title id={titleId}>The three-sided market, settling on one conserving ledger</title>
          <desc id={descId}>
            Three seller boxes across the top — Side 1 Labor (operator-for-hire),
            Side 2 Capital (a rented agent or fleet), Side 3 IP (a licensed skill
            or tool) — each flow down into a single escrow box, which sits on one
            conserving bond ledger spanning the width of the figure.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-accent)" />
            </marker>
          </defs>

          {/* Flows from each side into the escrow — drawn under the boxes. */}
          {SIDES.map((side) => (
            <path
              key={`flow-${side.n}`}
              d={`M ${side.x} ${28 + BOX_H} C ${side.x} 180, 300 170, 300 ${196}`}
              fill="none"
              stroke="var(--brand-accent)"
              strokeWidth="2"
              markerEnd={`url(#${arrowId})`}
            />
          ))}

          {/* Three seller boxes */}
          {SIDES.map((side) => (
            <g key={side.n} transform={`translate(${side.x - BOX_W / 2}, 28)`}>
              <rect width={BOX_W} height={BOX_H} rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
              <rect width={BOX_W} height="22" rx="0" fill="var(--brand-primary)" opacity="0.1" />
              <text x="10" y="15" fill="var(--brand-primary)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.06em' }}>
                {side.n.toUpperCase()}
              </text>
              <text x="10" y="40" fill="var(--text-primary)" style={{ font: '900 17px var(--font-display)' }}>
                {side.title}
              </text>
              <text x="10" y="58" fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
                {side.what}
              </text>
            </g>
          ))}

          {/* Escrow */}
          <g transform="translate(176, 196)">
            <rect width="248" height="44" rx="6" fill="var(--brand-accent)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="124" y="20" textAnchor="middle" fill="var(--brand-accent-foreground)" style={{ font: '800 14px var(--font-sans)', letterSpacing: '0.04em' }}>
              FLOAT-PLAN ESCROW
            </text>
            <text x="124" y="36" textAnchor="middle" fill="var(--brand-accent-foreground)" style={{ font: '500 13px var(--font-sans)' }}>
              pays out or refuses — cannot redirect
            </text>
          </g>

          {/* The one conserving ledger, spanning the base */}
          <g transform="translate(40, 264)">
            <rect width="520" height="40" rx="6" fill="var(--surface-strong)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="260" y="25" textAnchor="middle" fill="var(--text-primary)" style={{ font: '800 14px var(--font-sans)', letterSpacing: '0.04em' }}>
              ONE CONSERVING BOND LEDGER — value moves, never vanishes
            </text>
          </g>
          {/* escrow → ledger tick */}
          <line x1="300" y1="240" x2="300" y2="264" stroke="var(--border-strong)" strokeWidth="2" />
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        From Chapter 5, <span className="font-black text-[var(--text-primary)]">The Harbor Economy</span>.
        Three kinds of seller — labor, rentable agents, licensed skills — settle
        on one ledger through an escrow whose only two moves are pay-out and
        refund. It is two-sided until reputation ships; three-sided by design.
      </figcaption>
    </figure>
  )
}
