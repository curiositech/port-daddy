import { useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { TREE, SESSIONS, type ClaimNode, type Session } from './data'
import { useHover, dimFor } from './HoverContext'

/**
 * Mode C — squarified treemap with zoom-to-subtree.
 *
 * Uses d3.treemap with squarify tiling over a real d3.hierarchy. Color
 * encodes session ownership; unclaimed leaves get neutral gray. Click a
 * directory to zoom in; click outside or breadcrumb to zoom out. Animated
 * transitions on every zoom and hover.
 */
const W = 880
const H = 520

type Datum = ClaimNode
type Layout = d3.HierarchyRectangularNode<Datum>

export function TreemapViz() {
  const { session: hovered, setSession, setNodeId, nodeId: hoveredNodeId } = useHover()
  const [focusId, setFocusId] = useState<string>(TREE.id)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build the hierarchy once.
  const root = useMemo(() => {
    const r = d3.hierarchy<Datum>(TREE, d => d.children)
    r.sum(d => (d.children ? 0 : d.loc))
    r.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    return r
  }, [])

  // Find the focus subtree.
  const focus = useMemo(() => {
    return root.descendants().find(d => d.data.id === focusId) ?? root
  }, [root, focusId])

  // Compute treemap layout against the focus subtree.
  const layout = useMemo(() => {
    const node = d3.hierarchy<Datum>(focus.data, d => d.children).sum(d => (d.children ? 0 : d.loc))
    node.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    d3.treemap<Datum>()
      .size([W, H])
      .tile(d3.treemapSquarify.ratio(1.6))
      .paddingTop(d => (d.depth === 0 ? 0 : 22))
      .paddingInner(2)
      .round(true)(node)
    return node as Layout
  }, [focus])

  const leaves = layout.leaves()
  const dirs = layout.descendants().filter(d => d.children && d.depth > 0)

  const breadcrumb = focus.ancestors().reverse()

  return (
    <div ref={containerRef} className="space-y-3">
      {/* Breadcrumb (zoom trail) */}
      <div className="flex flex-wrap items-center gap-1 font-mono text-[13px]">
        {breadcrumb.map((b, i) => (
          <span key={b.data.id} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFocusId(b.data.id)}
              className={`underline-offset-2 hover:underline ${b.data.id === focusId ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}
            >
              {b.data.name === 'port-daddy' ? 'repo' : b.data.name}
            </button>
            {i < breadcrumb.length - 1 && <span className="text-[var(--text-muted)]"> / </span>}
          </span>
        ))}
        <span className="ml-auto text-xs text-[var(--text-muted)]">click a directory to zoom in</span>
      </div>

      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Squarified treemap of claim ownership">
          {/* Directory frames first (so leaves render on top) */}
          {dirs.map(d => (
            <DirCell key={d.data.id} d={d} onZoom={() => setFocusId(d.data.id)} />
          ))}
          {/* Leaves */}
          {leaves.map(d => (
            <LeafCell
              key={d.data.id}
              d={d}
              hoveredSession={hovered}
              isHoveredNode={hoveredNodeId === d.data.id}
              onHoverSession={setSession}
              onHoverNode={setNodeId}
            />
          ))}
        </svg>
      </div>
    </div>
  )
}

function DirCell({ d, onZoom }: { d: Layout; onZoom: () => void }) {
  const x = d.x0
  const y = d.y0
  const w = d.x1 - d.x0
  const h = d.y1 - d.y0
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="var(--border-strong)"
        strokeWidth={1.5}
      />
      <foreignObject x={x + 4} y={y + 2} width={Math.max(0, w - 8)} height={20}>
        <button
          type="button"
          onClick={onZoom}
          className="block w-full truncate text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          {d.data.name === 'port-daddy' ? '' : `${d.data.name}/`}
        </button>
      </foreignObject>
    </g>
  )
}

function LeafCell({
  d, hoveredSession, isHoveredNode, onHoverSession, onHoverNode,
}: {
  d: Layout
  hoveredSession: string | null
  isHoveredNode: boolean
  onHoverSession: (s: any) => void
  onHoverNode: (id: string | null) => void
}) {
  const claim = d.data.claim
  const session: Session | undefined = SESSIONS.find(s => s.id === claim?.session)
  const fill = claim && session ? session.color : 'var(--surface-raised)'
  const w = d.x1 - d.x0
  const h = d.y1 - d.y0
  const opacity = claim ? dimFor(claim.session, hoveredSession as any) : (hoveredSession ? 0.15 : 0.55)

  return (
    <g
      onMouseEnter={() => { onHoverNode(d.data.id); if (claim) onHoverSession(claim.session) }}
      onMouseLeave={() => { onHoverNode(null); onHoverSession(null) }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={d.x0}
        y={d.y0}
        width={w}
        height={h}
        fill={fill}
        fillOpacity={opacity}
        stroke={isHoveredNode ? 'var(--text-primary)' : 'var(--border-soft)'}
        strokeWidth={isHoveredNode ? 2 : 1}
        style={{ transition: 'fill-opacity 180ms ease, stroke 120ms ease' }}
      />
      {/* Name */}
      {w > 60 && h > 26 && (
        <text
          x={d.x0 + 8}
          y={d.y0 + 18}
          className="select-none fill-[var(--text-inverse)]"
          style={{ font: '600 12px ui-sans-serif, system-ui, sans-serif', pointerEvents: 'none' }}
          fillOpacity={claim ? 1 : 0.7}
        >
          {d.data.name}
        </text>
      )}
      {/* Claim label */}
      {claim && session && w > 80 && h > 44 && (
        <text
          x={d.x0 + 8}
          y={d.y0 + 34}
          className="select-none fill-[var(--text-inverse)]"
          style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', letterSpacing: '0.06em', textTransform: 'uppercase', pointerEvents: 'none' }}
        >
          {session.agent} · {claim.mode}
        </text>
      )}
      {/* Tooltip */}
      {isHoveredNode && (
        <Tooltip d={d} claim={claim} session={session} />
      )}
    </g>
  )
}

function Tooltip({ d, claim, session }: { d: Layout; claim?: any; session?: Session }) {
  // Flip below when the cell is too close to the top of the SVG.
  const TW = 232
  const TH = 60
  const room = 8
  const wantsAbove = d.y0 > TH + room
  const x = Math.max(4, Math.min(W - TW - 4, d.x0 + 8))
  const yTop = wantsAbove ? d.y0 - TH - room : d.y1 + room
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={x}
        y={yTop}
        width={TW}
        height={TH}
        fill="var(--surface-base)"
        stroke="var(--border-strong)"
        strokeWidth={1.5}
      />
      <text x={x + 8} y={yTop + 18} style={{ font: '600 12px ui-monospace, monospace', fill: 'var(--text-primary)' }}>
        {d.data.name}
      </text>
      <text x={x + 8} y={yTop + 34} style={{ font: '400 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>
        {d.data.kind} · {d.value} loc
      </text>
      {claim && session ? (
        <text x={x + 8} y={yTop + 50} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: session.color }}>
          ● {session.agent} ({claim.mode}) — {claim.intent.slice(0, 28)}
        </text>
      ) : (
        <text x={x + 8} y={yTop + 50} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>
          unclaimed
        </text>
      )}
    </g>
  )
}
