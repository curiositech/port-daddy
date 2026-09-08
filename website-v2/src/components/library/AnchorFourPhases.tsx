/**
 * The four phases of the Anchor Protocol (Chapter 2, `fig-anchor-four-phases.tex`),
 * drawn as a left-to-right refinement sequence. Each phase swaps the cryptographic
 * primitive, strengthens the property, and forecloses one specific threat (named in
 * the pill at the box base); the arrow records that the next phase is forced.
 *
 *   1. HS256 (symmetric pinning)        → forecloses algorithm confusion
 *   2. Ed25519 (asymmetric identity)    → forecloses shared-secret theft
 *   3. Macaroon (stigmergic delegation) → forecloses capability escalation
 *   4. Cuckoo filter (revocation)       → forecloses post-issuance compromise
 *
 * Layout is computed from constants (LEFT/GAP/BOX_W/BOX_H), not hand-placed, so the
 * boxes, gaps, arrows, footer and viewBox stay consistent and collision-free. Body
 * text is pre-wrapped to fit BOX_W; the pill sits below the last property line with
 * a clear gap. Every colour is a CSS custom property so the figure themes itself.
 * SVG <text> is ≥13px to satisfy the legibility floor.
 */

import React from 'react'

interface Phase {
  n: string
  primitive: string
  /** Pre-wrapped property lines (each a tspan) — kept short enough for BOX_W. */
  property: string[]
  forecloses: string
  /** Whether a forcing arrow follows this phase. */
  hasNext: boolean
}

const PHASES: Phase[] = [
  {
    n: 'Phase 1',
    primitive: 'HS256',
    property: ['Symmetric pinning. The', 'on-wire alg field is', 'ignored — the verifier', 'uses the pinned alg.'],
    forecloses: 'algorithm confusion',
    hasNext: true,
  },
  {
    n: 'Phase 2',
    primitive: 'Ed25519',
    property: ['Asymmetric identity. The', 'daemon is the root CA;', 'each harbor holds the', 'public key only.'],
    forecloses: 'shared-secret theft',
    hasNext: true,
  },
  {
    n: 'Phase 3',
    primitive: 'Macaroon',
    property: ['Stigmergic delegation.', 'Multi-hop attenuation:', 'child cap ⊊ parent, with', 'a fresh nonce per hop.'],
    forecloses: 'capability escalation',
    hasNext: true,
  },
  {
    n: 'Phase 4',
    primitive: 'Cuckoo filter',
    property: ['Revocation. 8-bit', 'fingerprints, gossip-', 'synced via version', 'vectors. ~2 min global.'],
    forecloses: 'post-issuance compromise',
    hasNext: false,
  },
]

// Computed layout — change one constant, everything follows.
const LEFT = 40
const GAP = 24
const BOX_W = 200
const BOX_H = 152
const BOX_Y = 44
const PROP_Y = 64 // first property baseline
const PROP_LH = 15 // property line height
const PILL_H = 22
const xOf = (i: number) => LEFT + i * (BOX_W + GAP)
const CONTENT_W = 4 * BOX_W + 3 * GAP // 4 boxes + 3 gaps
const VB_W = LEFT * 2 + CONTENT_W
const FOOTER_Y = BOX_Y + BOX_H + 18
const VB_H = FOOTER_Y + 34 + 8
const PILL_Y = BOX_H - PILL_H - 8 // pill rect top inside the box

export function AnchorFourPhases() {
  const uid = React.useId()
  const titleId = `${uid}-phases-title`
  const descId = `${uid}-phases-desc`
  const arrowId = `${uid}-phase-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block w-full min-w-[34rem] max-w-[66rem]"
        >
          <title id={titleId}>The four phases of the Anchor Protocol, drawn as a refinement sequence</title>
          <desc id={descId}>
            Four phase boxes left to right — Phase 1 HS256 (symmetric pinning),
            Phase 2 Ed25519 (asymmetric identity), Phase 3 Macaroon (stigmergic
            delegation), Phase 4 Cuckoo filter (revocation). An arrow runs between
            each pair, and each box names the one threat it forecloses.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {/* Connector arrows between boxes (no labels — the threat is named in
              each box pill, the caption carries the "why forced" argument). */}
          {PHASES.map((phase, i) => {
            if (!phase.hasNext) return null
            const x1 = xOf(i) + BOX_W
            const x2 = xOf(i + 1)
            const y = BOX_Y + BOX_H / 2
            return (
              <line
                key={`arrow-${phase.n}`}
                x1={x1 + 2}
                y1={y}
                x2={x2 - 6}
                y2={y}
                stroke="var(--brand-primary)"
                strokeWidth="2"
                markerEnd={`url(#${arrowId})`}
              />
            )
          })}

          {/* Four phase boxes */}
          {PHASES.map((phase, i) => (
            <g key={phase.n} transform={`translate(${xOf(i)}, ${BOX_Y})`}>
              <rect width={BOX_W} height={BOX_H} rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
              <rect width={BOX_W} height="26" rx="0" fill="var(--brand-primary)" opacity={i === 3 ? 0.18 : 0.1} />
              <text x="10" y="17" fill="var(--brand-primary)" style={{ font: '800 12px var(--font-sans)', letterSpacing: '0.06em' }}>
                {phase.n.toUpperCase()}
              </text>
              <text x="10" y="46" fill="var(--text-primary)" style={{ font: '900 17px var(--font-display)' }}>
                {phase.primitive}
              </text>
              <text x="10" y={PROP_Y} fill="var(--text-secondary)" style={{ font: '500 13px var(--font-sans)' }}>
                {phase.property.map((line, li) => (
                  <tspan key={li} x="10" dy={li === 0 ? 0 : PROP_LH}>
                    {line}
                  </tspan>
                ))}
              </text>
              {/* forecloses chip, pinned to the box base, clear of the text */}
              <rect x="8" y={PILL_Y} width={BOX_W - 16} height={PILL_H} rx="3" fill="var(--surface-base)" stroke="var(--brand-primary)" strokeWidth="1.5" />
              <text x={BOX_W / 2} y={PILL_Y + 15} textAnchor="middle" fill="var(--brand-primary)" style={{ font: '700 13px var(--font-sans)' }}>
                {'⊘'} {phase.forecloses}
              </text>
            </g>
          ))}

          {/* Mechanized-status footer band */}
          <g transform={`translate(${LEFT}, ${FOOTER_Y})`}>
            <rect width={CONTENT_W} height="34" rx="6" fill="var(--surface-strong)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x={CONTENT_W / 2} y="22" textAnchor="middle" fill="var(--text-primary)" style={{ font: '700 13px var(--font-sans)', letterSpacing: '0.02em' }}>
              ProVerif: Phases 1–3 mechanized (auth · alg-pinning · 17/17 replay-safe) — Phase 4 runtime-checked
            </text>
          </g>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        From Chapter 2, <span className="font-black text-[var(--text-primary)]">The Anchor Protocol</span>.
        Each phase is a refinement of the one before it: the primitive changes, the
        property strengthens, and one threat is foreclosed. The pill on each arrow
        records why the next phase is <span className="font-black text-[var(--text-primary)]">forced</span> —
        a constructive argument that no earlier phase suffices alone.
      </figcaption>
    </figure>
  )
}
