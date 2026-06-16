import React from 'react'
import { Link } from 'react-router-dom'
import { findWhitePaperByChapter } from '@/data/whitePapers'

/**
 * The reading-order DAG. The seven chapters as nodes on a stack, with the real
 * dependency edges between them: a solid edge means "stands on" (assumes), a
 * dashed edge means "is proved by." The recommended reading path — I → II → III
 * → IV, then dip into the proofs — is the column you read top to bottom.
 *
 * Themed entirely through `var(--token)` so the figure tracks light/dark with
 * the page. Node labels are ≥13px; the rung codes are uppercase, bold, tracked.
 */

interface Node {
  chapter: string
  x: number
  y: number
  group: 'explain' | 'prove'
  short: string
}

// Two columns: the four that explain (left), the three that prove (right).
// y increases downward = the read order; the proofs sit beside the chapter
// they discharge.
const NODES: Node[] = [
  { chapter: 'I', x: 150, y: 56, group: 'explain', short: 'The Legible Swarm' },
  { chapter: 'II', x: 150, y: 150, group: 'explain', short: 'The Single-Writer Kernel' },
  { chapter: 'III', x: 150, y: 244, group: 'explain', short: 'From Spawn to Person' },
  { chapter: 'IV', x: 150, y: 338, group: 'explain', short: 'The Harbor Economy' },
  { chapter: 'V', x: 420, y: 150, group: 'prove', short: 'The Anchor Protocol' },
  { chapter: 'VI', x: 420, y: 338, group: 'prove', short: 'The Bonded Commons' },
  { chapter: 'VII', x: 420, y: 408, group: 'prove', short: 'The Federated Harbor' },
]

const NODE_BY_CHAPTER = Object.fromEntries(NODES.map((n) => [n.chapter, n]))

// Edges. kind: 'read' = the spine you read down (assumes/underwrites);
// 'proof' = a dashed line from a proof chapter to what it discharges.
const EDGES: Array<{ from: string; to: string; kind: 'read' | 'proof' }> = [
  { from: 'I', to: 'II', kind: 'read' },
  { from: 'II', to: 'III', kind: 'read' },
  { from: 'III', to: 'IV', kind: 'read' },
  { from: 'V', to: 'II', kind: 'proof' },
  { from: 'V', to: 'IV', kind: 'proof' },
  { from: 'VI', to: 'IV', kind: 'proof' },
  { from: 'VII', to: 'IV', kind: 'proof' },
]

const NODE_W = 196
const NODE_H = 56

function edgePath(from: Node, to: Node): string {
  // Read edges run vertically inside the left column; proof edges arc in from
  // the right column to the left one. Draw a simple elbow.
  if (from.x === to.x) {
    const y1 = from.y + NODE_H / 2
    const y2 = to.y - NODE_H / 2
    return `M ${from.x} ${y1} L ${to.x} ${y2}`
  }
  // proof: start at the proof node's left edge, elbow into the target's right edge
  const x1 = from.x - NODE_W / 2
  const x2 = to.x + NODE_W / 2
  const midX = (x1 + x2) / 2
  return `M ${x1} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${x2} ${to.y}`
}

function DagNode({ node }: { node: Node }) {
  const paper = findWhitePaperByChapter(node.chapter)
  const isExplain = node.group === 'explain'
  return (
    <Link
      to={paper ? `#chapter-${node.chapter}` : '#'}
      aria-label={`Chapter ${node.chapter} — ${node.short}`}
      className="group focus-visible:outline-none"
    >
      <g transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}>
        <rect
          width={NODE_W}
          height={NODE_H}
          rx="6"
          fill={isExplain ? 'var(--surface-base)' : 'var(--surface-raised)'}
          stroke="var(--border-strong)"
          strokeWidth="2"
          className="transition-[fill] group-hover:[fill:var(--surface-strong)] group-focus-visible:[stroke:var(--interactive-focus)]"
        />
        {/* chapter chip */}
        <rect width="40" height={NODE_H} rx="0" fill={isExplain ? 'var(--brand-primary)' : 'var(--brand-accent)'} />
        <text
          x="20"
          y={NODE_H / 2 + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="var(--brand-primary-foreground)"
          style={{ font: '900 16px var(--font-mono)' }}
        >
          {node.chapter}
        </text>
        <text
          x="52"
          y={NODE_H / 2 + 1}
          dominantBaseline="middle"
          fill="var(--text-primary)"
          style={{ font: '700 14px var(--font-sans)' }}
        >
          {node.short}
        </text>
      </g>
    </Link>
  )
}

export function ReadingDag() {
  const uid = React.useId()
  const titleId = `${uid}-dag-title`
  const descId = `${uid}-dag-desc`
  const arrowReadId = `${uid}-arrow-read`
  const arrowProofId = `${uid}-arrow-proof`
  return (
    <figure className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] shadow-[var(--shadow-brutal)]">
      <div className="overflow-x-auto p-[var(--space-5)]">
        <svg
          viewBox="0 0 540 470"
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className="mx-auto block min-w-[34rem] max-w-[44rem]"
        >
          <title id={titleId}>The reading-order dependency graph of the seven chapters</title>
          <desc id={descId}>
            The four explaining chapters form a vertical spine read top to bottom:
            I the Legible Swarm, II the Single-Writer Kernel, III From Spawn to
            Person, IV the Harbor Economy. Dashed lines connect the three proving
            chapters — V the Anchor Protocol, VI the Bonded Commons, VII the
            Federated Harbor — to the chapters they discharge.
          </desc>

          <defs>
            <marker id={arrowReadId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--brand-primary)" />
            </marker>
            <marker id={arrowProofId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--text-muted)" />
            </marker>
          </defs>

          {/* Edges first, under the nodes. */}
          {EDGES.map((edge) => {
            const from = NODE_BY_CHAPTER[edge.from]
            const to = NODE_BY_CHAPTER[edge.to]
            if (!from || !to) return null
            const isRead = edge.kind === 'read'
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edgePath(from, to)}
                fill="none"
                stroke={isRead ? 'var(--brand-primary)' : 'var(--text-muted)'}
                strokeWidth={isRead ? 2.5 : 1.75}
                strokeDasharray={isRead ? undefined : '5 4'}
                markerEnd={isRead ? `url(#${arrowReadId})` : `url(#${arrowProofId})`}
              />
            )
          })}

          {/* Column captions */}
          <text x="150" y="24" textAnchor="middle" fill="var(--text-muted)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.08em' }}>
            FOUR THAT EXPLAIN — READ DOWN
          </text>
          <text x="420" y="120" textAnchor="middle" fill="var(--text-muted)" style={{ font: '800 13px var(--font-sans)', letterSpacing: '0.08em' }}>
            THREE THAT PROVE
          </text>

          {NODES.map((node) => (
            <DagNode key={node.chapter} node={node} />
          ))}
        </svg>
      </div>

      <figcaption className="grid gap-[var(--space-3)] border-t-2 border-[var(--border-strong)] p-[var(--space-4)] sm:grid-cols-[1fr_auto] sm:items-center">
        <p className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          Read the left column top to bottom — that is the whole argument, in
          order. Each dashed line is a promise an explaining chapter makes and a
          proving chapter keeps. Click any chapter to jump to it.
        </p>
        <ul className="flex flex-wrap gap-[var(--space-3)]">
          <li className="flex items-center gap-[var(--space-2)]">
            <span aria-hidden="true" className="h-[2px] w-[var(--space-5)] bg-[var(--brand-primary)]" />
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              stands on
            </span>
          </li>
          <li className="flex items-center gap-[var(--space-2)]">
            <span aria-hidden="true" className="h-0 w-[var(--space-5)] border-t-2 border-dashed border-[var(--text-muted)]" />
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              proved by
            </span>
          </li>
        </ul>
      </figcaption>
    </figure>
  )
}
