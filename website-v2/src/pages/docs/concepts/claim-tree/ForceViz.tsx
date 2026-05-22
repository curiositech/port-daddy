import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { TREE, IMPORTS, SESSIONS, type ClaimNode } from './data'
import { useHover, dimFor } from './HoverContext'

declare global {
  interface SVGSVGElement {
    __zoom?: any
  }
}

/**
 * Mode E — real force-directed graph with d3.forceSimulation.
 *
 * Nodes are files + symbols. Tree edges (parent-child) connect a file to
 * its symbols and a directory to its files. Import edges are dashed and
 * highlighted in accent color. Drag nodes to perturb the simulation;
 * hover a node to highlight its 1-hop neighborhood.
 */
const W = 800
const H = 480

type GNode = {
  id: string
  name: string
  kind: ClaimNode['kind']
  claim?: ClaimNode['claim']
  loc: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
}

type GLink = { source: string | GNode; target: string | GNode; kind: 'tree' | 'import' }

function collectNodes(node: ClaimNode, into: GNode[]) {
  if (node.kind !== 'repo') {
    into.push({ id: node.id, name: node.name, kind: node.kind, claim: node.claim, loc: Math.max(1, node.loc) })
  }
  node.children?.forEach(c => collectNodes(c, into))
}

function collectTreeLinks(node: ClaimNode, into: GLink[]) {
  if (!node.children) return
  for (const c of node.children) {
    if (node.kind !== 'repo') into.push({ source: node.id, target: c.id, kind: 'tree' })
    collectTreeLinks(c, into)
  }
}

export function ForceViz() {
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  const simRef = useRef<d3.Simulation<GNode, any> | null>(null)
  const { session: hovered, setSession, setNodeId, nodeId: hoveredNodeId } = useHover()
  const [, setTick] = useState(0)
  const [transform, setTransform] = useState<{ k: number; x: number; y: number }>({ k: 1, x: 0, y: 0 })

  const { nodes, links } = useMemo(() => {
    const nodes: GNode[] = []
    collectNodes(TREE, nodes)
    const links: GLink[] = []
    collectTreeLinks(TREE, links)
    for (const im of IMPORTS) {
      if (nodes.find(n => n.id === im.from) && nodes.find(n => n.id === im.to)) {
        links.push({ source: im.from, target: im.to, kind: 'import' })
      }
    }
    // Pre-seed positions on a coarse grid so the first render has valid
    // x/y, then settle the simulation synchronously here so React's first
    // render shows a clean layout (no "translate(undefined, ...)" frame).
    const cols = Math.ceil(Math.sqrt(nodes.length))
    nodes.forEach((n, i) => {
      n.x = W * 0.15 + (i % cols) * ((W * 0.7) / cols)
      n.y = H * 0.15 + Math.floor(i / cols) * ((H * 0.7) / cols)
    })
    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance((l: any) => (l.kind === 'import' ? 110 : 70)).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.6))
      .force('x', d3.forceX(W / 2).strength(0.08))
      .force('y', d3.forceY(H / 2).strength(0.08))
      .force('collide', d3.forceCollide<GNode>().radius(n => radiusFor(n) + 6))
      .stop()
    for (let i = 0; i < 300; i++) sim.tick()
    return { nodes, links }
  }, [])

  // Idle gentle refinement: keep nudging the layout briefly after mount
  // so it animates into place. Reuses settled positions from useMemo.
  useEffect(() => {
    const sim = d3.forceSimulation(nodes as any)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance((l: any) => (l.kind === 'import' ? 110 : 70)).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-260))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.4))
      .force('collide', d3.forceCollide<GNode>().radius(n => radiusFor(n) + 6))
      .alphaTarget(0)
      .alpha(0.25)
      .alphaDecay(0.04)
      .on('tick', () => setTick(t => t + 1))
    simRef.current = sim as unknown as d3.Simulation<GNode, any>
    return () => { sim.stop(); simRef.current = null }
  }, [nodes, links])

  // Wire zoom/pan on the SVG once mounted.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const sel = d3.select(svg)

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.4, 4])
      .filter((event) => {
        if (event.type === 'wheel') return true
        // Only initiate pan on background drag, not on node grab.
        return !(event.target as Element).closest('[data-node="1"]')
      })
      .on('zoom', (event) => {
        setTransform({ k: event.transform.k, x: event.transform.x, y: event.transform.y })
      })

    sel.call(zoom as any)
    return () => { sel.on('.zoom', null) }
  }, [])

  // Drag via native React + SVG coordinate math (no d3-selection .data()
  // binding so we don't fight React over the DOM).
  const dragState = useRef<{ id: string | null; startMouse: [number, number]; startNode: [number, number] }>({
    id: null, startMouse: [0, 0], startNode: [0, 0],
  })

  function svgPoint(e: { clientX: number; clientY: number }): [number, number] {
    const svg = svgRef.current
    if (!svg) return [e.clientX, e.clientY]
    const rect = svg.getBoundingClientRect()
    // Convert client → viewBox coords, accounting for current zoom transform
    const vbX = (e.clientX - rect.left) * (W / rect.width)
    const vbY = (e.clientY - rect.top) * (H / rect.height)
    return [(vbX - transform.x) / transform.k, (vbY - transform.y) / transform.k]
  }

  function startDrag(n: GNode, e: React.PointerEvent) {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const sim = simRef.current
    sim?.alphaTarget(0.3).restart()
    const m = svgPoint(e)
    dragState.current = { id: n.id, startMouse: m, startNode: [n.x ?? 0, n.y ?? 0] }
  }
  function moveDrag(e: React.PointerEvent) {
    const ds = dragState.current
    if (!ds.id) return
    const node = nodes.find(x => x.id === ds.id)
    if (!node) return
    const m = svgPoint(e)
    node.fx = ds.startNode[0] + (m[0] - ds.startMouse[0])
    node.fy = ds.startNode[1] + (m[1] - ds.startMouse[1])
  }
  function endDrag(_e: React.PointerEvent) {
    const ds = dragState.current
    if (!ds.id) return
    const node = nodes.find(x => x.id === ds.id)
    if (node) { node.fx = null; node.fy = null }
    simRef.current?.alphaTarget(0)
    dragState.current = { id: null, startMouse: [0, 0], startNode: [0, 0] }
  }

  // Build a 1-hop neighborhood index for hover highlight.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const n of nodes) m.set(n.id, new Set([n.id]))
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      m.get(s)?.add(t)
      m.get(t)?.add(s)
    }
    return m
  }, [nodes, links])

  const highlightSet: Set<string> | null = hoveredNodeId ? neighbors.get(hoveredNodeId) ?? null : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)]">
        <span><span className="inline-block h-[2px] w-5 bg-[var(--border-strong)] align-middle mr-1" /> tree edge</span>
        <span><svg width="20" height="6" className="inline align-middle mr-1"><line x1="0" y1="3" x2="20" y2="3" stroke="var(--brand-accent)" strokeWidth="2" strokeDasharray="4 3" /></svg> import edge</span>
        <span className="ml-auto">drag a node · scroll to zoom · drag background to pan</span>
      </div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Force-directed graph of claim ownership with imports" style={{ cursor: 'grab' }}>
          <g ref={gRef} transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
          {/* Links */}
          <g>
            {links.map((l, i) => {
              const s = typeof l.source === 'string' ? nodes.find(n => n.id === l.source)! : l.source
              const t = typeof l.target === 'string' ? nodes.find(n => n.id === l.target)! : l.target
              if (!s.x || !t.x) return null
              const inHighlight = !highlightSet || (highlightSet.has(s.id) && highlightSet.has(t.id))
              return (
                <line
                  key={i}
                  x1={s.x} y1={s.y}
                  x2={t.x} y2={t.y}
                  stroke={l.kind === 'import' ? 'var(--brand-accent)' : 'var(--border-strong)'}
                  strokeWidth={l.kind === 'import' ? 1.5 : 1.2}
                  strokeDasharray={l.kind === 'import' ? '4 3' : 'none'}
                  strokeOpacity={inHighlight ? 0.85 : 0.18}
                  style={{ transition: 'stroke-opacity 200ms ease' }}
                />
              )
            })}
          </g>
          {/* Nodes */}
          <g>
            {nodes.map(n => {
              const session = SESSIONS.find(s => s.id === n.claim?.session)
              const fill = session ? session.color : (n.kind === 'symbol' ? 'var(--surface-raised)' : 'var(--surface-base)')
              const stroke = hoveredNodeId === n.id ? 'var(--text-primary)' : 'var(--border-strong)'
              const sessionOpacity = n.claim ? dimFor(n.claim.session as any, hovered) : (hovered ? 0.2 : 0.85)
              const nbrOpacity = !highlightSet || highlightSet.has(n.id) ? 1 : 0.18
              const opacity = Math.min(sessionOpacity, nbrOpacity)
              const r = radiusFor(n)
              return (
                <g key={n.id}
                   data-node="1"
                   transform={`translate(${n.x}, ${n.y})`}
                   onPointerDown={(e) => startDrag(n, e)}
                   onPointerMove={moveDrag}
                   onPointerUp={endDrag}
                   onPointerCancel={endDrag}
                   onMouseEnter={() => { setNodeId(n.id); if (n.claim) setSession(n.claim.session as any) }}
                   onMouseLeave={() => { setNodeId(null); setSession(null) }}
                   style={{ cursor: 'grab', opacity, transition: 'opacity 180ms ease' }}>
                  <circle r={r} fill={fill} stroke={stroke} strokeWidth={hoveredNodeId === n.id ? 2.5 : 1.5} />
                  <text textAnchor="middle" dy={r + 12}
                        style={{ font: `500 ${n.kind === 'symbol' ? 10.5 : 11.5}px ui-sans-serif, system-ui, sans-serif`, fill: 'var(--text-primary)', pointerEvents: 'none' }}>
                    {n.name}
                  </text>
                </g>
              )
            })}
          </g>
          </g>
          {/* Reset-view button */}
          <g transform={`translate(${W - 88}, ${H - 30})`}>
            <foreignObject x={0} y={-16} width={80} height={26}>
              <button type="button"
                      onClick={() => {
                        const svg = svgRef.current
                        if (!svg) return
                        d3.select(svg).transition().duration(400).call(
                          (d3.zoom() as any).transform,
                          d3.zoomIdentity
                        )
                      }}
                      className="w-full border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">
                reset view
              </button>
            </foreignObject>
          </g>
        </svg>
      </div>
    </div>
  )
}

function radiusFor(n: GNode): number {
  if (n.kind === 'symbol') return 12 + Math.sqrt(n.loc) * 0.4
  if (n.kind === 'file') return 16 + Math.sqrt(n.loc) * 0.5
  return 14
}
