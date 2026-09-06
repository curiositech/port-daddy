/**
 * Gossip-synchronized revocation (Chapter 2, `fig-anchor-revocation-gossip.tex`),
 * drawn as five time panels of a five-daemon mesh. At t=0 daemon A revokes a Harbor
 * Card locally; anti-entropy gossip ships the revocation delta to two random peers
 * every 30 s, so the "filter contains revoked card" state spreads epidemically:
 *
 *   t=0    A revokes           (1 of 5 know)
 *   t=30s  A → B, A → D        (3 of 5)
 *   t=60s  B → C, D → E        (5 of 5)
 *   t=90s  version vectors reconcile
 *   t=120s steady state — the leaked card is rejected everywhere
 *
 * A new revocation reaches all m peers in O(log m) gossip rounds (≈ 2 min for ten
 * daemons). Every color is a CSS custom property (`var(--token)`), so the figure
 * theme-switches via the `[data-theme]` cascade with no JS. All `<text>` is ≥13px;
 * the node labels and time codes are bold.
 */

import React from 'react'

// A..E placed on a pentagon, radius 26, around each panel's local center.
// Angles match the .tex: A=90°, B=18°, C=306°, D=234°, E=162° (degrees, CCW).
const NODE_ANGLES: Record<string, number> = { A: 90, B: 18, C: 306, D: 234, E: 162 }
const NODE_IDS = ['A', 'B', 'C', 'D', 'E'] as const
const RADIUS = 26

function nodePos(id: string): { x: number; y: number } {
  const rad = (NODE_ANGLES[id] * Math.PI) / 180
  // SVG y grows downward, so negate the sine to keep A at the top.
  return { x: RADIUS * Math.cos(rad), y: -RADIUS * Math.sin(rad) }
}

// Mesh edges: pentagon ring + two chords (A–D, B–E), matching the .tex.
const MESH_EDGES: Array<[string, string]> = [
  ['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'A'],
  ['A', 'D'], ['B', 'E'],
]

interface Panel {
  t: string
  /** Daemons whose filter now contains the revoked card. */
  revoked: string[]
  /** Gossip deltas delivered this round, drawn as arrows. */
  gossip: Array<[string, string]>
  note: string
  cx: number
}

const PANELS: Panel[] = [
  { t: 't = 0', revoked: ['A'], gossip: [], note: 'A revokes locally', cx: 70 },
  { t: 't = 30s', revoked: ['A', 'B', 'D'], gossip: [['A', 'B'], ['A', 'D']], note: 'vv: A,B,D = 1', cx: 222 },
  { t: 't = 60s', revoked: ['A', 'B', 'C', 'D', 'E'], gossip: [['B', 'C'], ['D', 'E']], note: 'vv: all = 1', cx: 374 },
  { t: 't = 90s', revoked: ['A', 'B', 'C', 'D', 'E'], gossip: [], note: 'vectors reconcile', cx: 526 },
  { t: 't = 120s', revoked: ['A', 'B', 'C', 'D', 'E'], gossip: [], note: 'rejected everywhere', cx: 678 },
]

const PANEL_W = 132
const PANEL_TOP = 30
const PANEL_H = 168
const MESH_CY = 96 // local mesh center y inside a panel

export function AnchorRevocationGossip() {
  const uid = React.useId()
  const titleId = `${uid}-gossip-title`
  const descId = `${uid}-gossip-desc`
  const arrowId = `${uid}-gossip-arrow`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 748 232"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[48rem]"
        >
          <title id={titleId}>A revocation spreading across a five-daemon mesh by gossip</title>
          <desc id={descId}>
            Five time panels, left to right, each a five-node mesh of daemons A
            through E. At t=0 only A holds the revoked card; by t=30s A has gossiped
            it to B and D; by t=60s all five know; the last two panels show the
            version vectors reconciling and the leaked card rejected everywhere.
            Filled nodes hold the revocation; arrows are the gossip delta each round.
          </desc>

          <defs>
            <marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
          </defs>

          {PANELS.map((panel) => {
            const left = panel.cx - PANEL_W / 2
            return (
              <g key={panel.t}>
                {/* panel frame */}
                <rect x={left} y={PANEL_TOP} width={PANEL_W} height={PANEL_H} rx="6" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
                <text x={panel.cx} y={PANEL_TOP + 19} textAnchor="middle" fill="var(--text-primary)" style={{ font: '800 14px var(--font-sans)' }}>
                  {panel.t}
                </text>

                {/* mesh, centered locally */}
                <g transform={`translate(${panel.cx}, ${PANEL_TOP + MESH_CY})`}>
                  {/* edges first */}
                  {MESH_EDGES.map(([a, b]) => {
                    const pa = nodePos(a)
                    const pb = nodePos(b)
                    return (
                      <line key={`${panel.t}-${a}${b}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="var(--border-default)" strokeWidth="1" strokeDasharray="2 3" />
                    )
                  })}

                  {/* gossip deltas this round */}
                  {panel.gossip.map(([a, b]) => {
                    const pa = nodePos(a)
                    const pb = nodePos(b)
                    // shorten the segment so the arrowhead sits at the node edge
                    const dx = pb.x - pa.x
                    const dy = pb.y - pa.y
                    const len = Math.hypot(dx, dy) || 1
                    const ux = dx / len
                    const uy = dy / len
                    return (
                      <line
                        key={`${panel.t}-gossip-${a}${b}`}
                        x1={pa.x + ux * 9}
                        y1={pa.y + uy * 9}
                        x2={pb.x - ux * 11}
                        y2={pb.y - uy * 11}
                        stroke="var(--brand-primary)"
                        strokeWidth="2"
                        markerEnd={`url(#${arrowId})`}
                      />
                    )
                  })}

                  {/* daemon nodes */}
                  {NODE_IDS.map((id) => {
                    const p = nodePos(id)
                    const isRevoked = panel.revoked.includes(id)
                    return (
                      <g key={`${panel.t}-node-${id}`}>
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r="9"
                          fill={isRevoked ? 'var(--brand-primary)' : 'var(--surface-base)'}
                          stroke={isRevoked ? 'var(--brand-primary)' : 'var(--border-strong)'}
                          strokeWidth={isRevoked ? 2.5 : 2}
                        />
                        <text
                          x={p.x}
                          y={p.y + 1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill={isRevoked ? 'var(--brand-primary-foreground)' : 'var(--text-primary)'}
                          style={{ font: '800 13px var(--font-mono)' }}
                        >
                          {id}
                        </text>
                      </g>
                    )
                  })}
                </g>

                {/* per-panel note */}
                <text x={panel.cx} y={PANEL_TOP + PANEL_H - 12} textAnchor="middle" fill="var(--text-secondary)" style={{ font: '600 13px var(--font-sans)' }}>
                  {panel.note}
                </text>
              </g>
            )
          })}

          {/* Legend strip beneath the panels. */}
          <g transform="translate(70, 210)">
            <circle cx="6" cy="-2" r="6" fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth="2" />
            <text x="18" y="2" fill="var(--text-muted)" style={{ font: '600 13px var(--font-sans)' }}>filter clean</text>
            <circle cx="150" cy="-2" r="6" fill="var(--brand-primary)" stroke="var(--brand-primary)" strokeWidth="2" />
            <text x="162" y="2" fill="var(--text-muted)" style={{ font: '600 13px var(--font-sans)' }}>holds revoked card</text>
            <line x1="330" y1="-2" x2="362" y2="-2" stroke="var(--brand-primary)" strokeWidth="2" markerEnd={`url(#${arrowId})`} />
            <text x="370" y="2" fill="var(--text-muted)" style={{ font: '600 13px var(--font-sans)' }}>gossip delta this round</text>
          </g>
        </svg>
      </div>
      <figcaption className="border-t-2 border-[var(--border-strong)] p-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
        From Chapter 2, <span className="font-black text-[var(--text-primary)]">The Anchor Protocol</span>.
        Each daemon keeps a cuckoo filter and a version vector over its peers; every
        30 s it picks a random peer and ships the deltas. A single revocation reaches
        all <span className="font-black text-[var(--text-primary)]">m</span> daemons in
        O(log m) rounds — about two minutes for ten — well inside the window where a
        leaked card is still economically useful.
      </figcaption>
    </figure>
  )
}
