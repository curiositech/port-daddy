import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { TREE, SESSIONS, type ClaimNode, type Session } from './data'
import { useHover, dimFor } from './HoverContext'

/**
 * Mode D — zoomable sunburst (Bostock's classic interaction pattern).
 *
 * Click an arc to zoom that subtree to the full circle. Click the center
 * to zoom back out. Arcs colored by claim ownership; unclaimed get
 * neutral gray. Labels rotate to be readable per-quadrant.
 *
 * Adapted from https://observablehq.com/@d3/zoomable-sunburst
 */
const SIZE = 540

// Local node shape (currently unused — kept commented for future
// zoom/animation work so a later commit doesn't re-derive it).
// interface Node extends d3.HierarchyRectangularNode<ClaimNode> {
//   current: { x0: number; y0: number; x1: number; y1: number }
//   target?: { x0: number; y0: number; x1: number; y1: number }
// }

export function SunburstViz() {
  const { session: hovered, setSession, setNodeId, nodeId: hoveredNodeId } = useHover()
  const [focusId, setFocusId] = useState<string>(TREE.id)

  const root = useMemo(() => {
    const r = d3.hierarchy<ClaimNode>(TREE, d => d.children)
    r.sum(d => (d.children ? 0 : d.loc))
    r.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    return d3.partition<ClaimNode>().size([2 * Math.PI, r.height + 1])(r)
  }, [])

  const focus = useMemo(() => root.descendants().find(d => d.data.id === focusId) ?? root, [root, focusId])

  // Visible-depth = how many rings will be drawn for the current focus.
  // Used to size each ring so the outermost ring stops at the SVG radius.
  const visibleDepth = useMemo(() => {
    const fd = focus.descendants().filter(d => d !== focus)
    const maxD = fd.length === 0 ? 1 : Math.max(...fd.map(d => d.depth - focus.depth))
    return Math.max(1, maxD)
  }, [focus])

  // Compute current x0/x1/y0/y1 relative to the focus subtree.
  const nodesWithFocus = useMemo(() => {
    return root.descendants().map(d => {
      const y0 = Math.max(0, d.y0 - focus.depth)
      const y1 = Math.max(0, d.y1 - focus.depth)
      const focusSpan = focus.x1 - focus.x0
      const x0 = Math.max(focus.x0, Math.min(focus.x1, d.x0))
      const x1 = Math.max(focus.x0, Math.min(focus.x1, d.x1))
      const adj_x0 = ((x0 - focus.x0) / focusSpan) * 2 * Math.PI
      const adj_x1 = ((x1 - focus.x0) / focusSpan) * 2 * Math.PI
      return { node: d, x0: adj_x0, x1: adj_x1, y0, y1, visible: d.y1 > focus.depth && (x1 - x0) > 1e-6 }
    })
  }, [root, focus])

  // Reserve the center for the focus label; each ring takes the rest.
  const centerR = 44
  const outerR = SIZE / 2 - 10
  const ringWidth = (outerR - centerR) / visibleDepth
  const radius = (y: number) => centerR + (y - 1) * ringWidth   // y=1 = innermost ring
  const arc = d3.arc<{ x0: number; x1: number; y0: number; y1: number }>()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .padAngle(d => Math.min((d.x1 - d.x0) / 2, 0.005))
    .padRadius(outerR)
    .innerRadius(d => radius(d.y0))
    .outerRadius(d => Math.max(radius(d.y0), radius(d.y1) - 1))

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">
        Click an arc to zoom into that subtree. Click the center to zoom out.
      </div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="block h-auto w-full" role="img" aria-label="Zoomable sunburst of claim tree">
          {nodesWithFocus.map(({ node, x0, x1, y0, y1, visible }) => {
            if (!visible) return null
            if (node === focus) return null
            const claim = node.data.claim
            const session = SESSIONS.find(s => s.id === claim?.session)
            // Use a soft neutral tint for dirs + a paler one for unclaimed leaves,
            // so the rings remain visible against the page background.
            const fill = claim && session
              ? session.color
              : (node.children ? 'oklch(0.92 0.012 280)' : 'oklch(0.96 0.008 280)')
            const opacity = claim
              ? dimFor(claim.session as any, hovered)
              : (hovered ? 0.35 : 1)
            const d = arc({ x0, x1, y0, y1 }) ?? ''
            const hasChildren = (node.children?.length ?? 0) > 0
            return (
              <g key={node.data.id}
                 onMouseEnter={() => { setNodeId(node.data.id); if (claim) setSession(claim.session as any) }}
                 onMouseLeave={() => { setNodeId(null); setSession(null) }}
                 onClick={() => hasChildren && setFocusId(node.data.id)}
                 style={{ cursor: hasChildren ? 'pointer' : 'default' }}>
                <path d={d} fill={fill} fillOpacity={opacity}
                      stroke={hoveredNodeId === node.data.id ? 'var(--text-primary)' : 'var(--border-strong)'}
                      strokeOpacity={hoveredNodeId === node.data.id ? 1 : 0.5}
                      strokeWidth={hoveredNodeId === node.data.id ? 1.8 : 0.8}
                      style={{ transition: 'fill-opacity 180ms ease, stroke 120ms ease' }} />
                <ArcLabel node={node} x0={x0} x1={x1} y0={y0} y1={y1} radiusFn={radius} claim={claim} session={session} />
              </g>
            )
          })}
          {/* Center button = current focus */}
          <g onClick={() => focus.parent && setFocusId(focus.parent.data.id)} style={{ cursor: focus.parent ? 'pointer' : 'default' }}>
            <circle r={centerR} fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth={1.5} />
            <text textAnchor="middle" dy="-3" style={{ font: '600 14px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-primary)' }}>
              {focus.data.name === 'port-daddy' ? 'repo' : focus.data.name}
            </text>
            <text textAnchor="middle" dy="14" style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {focus.parent ? 'click to zoom out' : 'root'}
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}

function ArcLabel({ node, x0, x1, y0, y1, radiusFn, claim, session }: { node: any; x0: number; x1: number; y0: number; y1: number; radiusFn: (y: number) => number; claim?: any; session?: Session }) {
  const angleSpan = x1 - x0
  if (angleSpan < 0.13) return null     // too thin to label
  const midAngle = (x0 + x1) / 2
  const midRadius = (radiusFn(y0) + radiusFn(y1)) / 2
  const x = Math.cos(midAngle - Math.PI / 2) * midRadius
  const y = Math.sin(midAngle - Math.PI / 2) * midRadius
  // Rotate so text reads upright on both halves.
  let rotate = (midAngle * 180) / Math.PI - 90
  if (rotate > 90) rotate -= 180
  const label = claim && session
    ? `${node.data.name} (${session.agent})`
    : node.data.name
  return (
    <text
      x={x}
      y={y}
      transform={`rotate(${rotate}, ${x}, ${y})`}
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ font: '500 10.5px ui-sans-serif, system-ui, sans-serif', fill: claim ? 'var(--text-inverse)' : 'var(--text-primary)', pointerEvents: 'none' }}
    >
      {label.length > 16 ? label.slice(0, 14) + '…' : label}
    </text>
  )
}
