import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { TREE, type ClaimNode } from './data'

/**
 * Hero diagram: filesystem tree on the left, AST tree on the right,
 * joined at `lib/auth.ts`. Hovering a file on the left highlights it +
 * its AST root on the right. Symbol nodes expand on click.
 *
 * Uses d3.tree() for both layouts so spacing is proper. Curved links via
 * d3.linkHorizontal.
 */
const W = 880
const H = 360

// Filesystem subset (no AST yet — files are leaves in this tree).
const FS_TREE: ClaimNode = {
  id: 'repo:port-daddy',
  name: 'port-daddy',
  kind: 'repo',
  loc: 0,
  children: TREE.children!.map(stripAst),
}

function stripAst(n: ClaimNode): ClaimNode {
  if (n.kind === 'file') return { ...n, children: undefined }
  if (!n.children) return n
  return { ...n, children: n.children.map(stripAst) }
}

// AST tree for lib/auth.ts.
const AUTH_AST: ClaimNode = (() => {
  const lib = TREE.children!.find(c => c.id === 'dir:lib')!
  const auth = lib.children!.find(c => c.id === 'file:lib/auth.ts')!
  return {
    id: auth.id,
    name: 'lib/auth.ts',
    kind: 'file',
    loc: auth.loc,
    children: [
      {
        id: 'ast:AuthService',
        name: 'AuthService',
        kind: 'symbol',
        symbol: 'AuthService',
        loc: 0,
        children: auth.children!.filter(c => c.symbol?.startsWith('AuthService.')).map(c => ({
          ...c,
          name: c.name,
        })),
      },
      ...auth.children!.filter(c => !c.symbol?.startsWith('AuthService.')),
    ],
  }
})()

export function TwoTreesViz() {
  const [hoverFileId, setHoverFileId] = useState<string | null>(null)

  return (
    <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Two trees joined at the file">
        {/* Headers */}
        <text x={W * 0.225} y={26} textAnchor="middle"
              style={{ font: '600 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Filesystem tree
        </text>
        <text x={W * 0.775} y={26} textAnchor="middle"
              style={{ font: '600 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          AST tree (for lib/auth.ts)
        </text>

        {/* Left tree: filesystem */}
        <TreeBlock
          tree={FS_TREE}
          xOffset={20}
          width={W * 0.4}
          height={H - 50}
          yOffset={42}
          highlightId={hoverFileId}
          onHover={setHoverFileId}
          highlightCallback={id => id === 'file:lib/auth.ts'}
        />

        {/* Join arrow */}
        <JoinArrow active={hoverFileId === 'file:lib/auth.ts'} />

        {/* Right tree: AST */}
        <TreeBlock
          tree={AUTH_AST}
          xOffset={W * 0.55}
          width={W * 0.42}
          height={H - 50}
          yOffset={42}
          highlightId={hoverFileId === 'file:lib/auth.ts' ? 'file:lib/auth.ts' : null}
          onHover={() => {}}
          highlightCallback={id => id === 'file:lib/auth.ts'}
        />
      </svg>
    </div>
  )
}

function TreeBlock({ tree, xOffset, width, height, yOffset, highlightId, onHover, highlightCallback }: {
  tree: ClaimNode
  xOffset: number
  width: number
  height: number
  yOffset: number
  highlightId: string | null
  onHover: (id: string | null) => void
  highlightCallback: (id: string) => boolean
}) {
  const layout = useMemo(() => {
    const root = d3.hierarchy<ClaimNode>(tree, d => d.children)
    d3.tree<ClaimNode>().size([height, width - 40]).nodeSize([26, 130])(root)
    return root.descendants() as d3.HierarchyPointNode<ClaimNode>[]
  }, [tree, width, height])

  const linkGenerator = d3.linkHorizontal<any, d3.HierarchyPointNode<ClaimNode>>()
    .x(d => (d as any).y)
    .y(d => (d as any).x)

  // Center the tree vertically.
  const xExtent = d3.extent(layout, n => (n as any).x) as [number, number]
  const centerY = (height - (xExtent[1] - xExtent[0])) / 2 - xExtent[0]

  return (
    <g transform={`translate(${xOffset}, ${yOffset + centerY})`}>
      {/* Links */}
      <g>
        {layout.filter(n => n.parent).map((n, i) => {
          const link = { source: n.parent!, target: n }
          return <path key={i} d={linkGenerator(link as any) ?? ''} fill="none" stroke="var(--border-strong)" strokeWidth={1.2} strokeOpacity={0.6} />
        })}
      </g>
      {/* Nodes */}
      <g>
        {layout.map(n => {
          const id = n.data.id
          const isJoin = highlightCallback(id)
          const isHovered = highlightId === id
          const fill = isJoin ? 'var(--brand-accent)' : (n.children ? 'var(--surface-raised)' : 'var(--surface-base)')
          return (
            <g key={id} transform={`translate(${(n as any).y}, ${(n as any).x})`}
               onMouseEnter={() => onHover(id)} onMouseLeave={() => onHover(null)}
               style={{ cursor: 'pointer' }}>
              <circle r={isJoin ? 6 : 4} fill={fill} stroke={isJoin ? 'var(--text-primary)' : 'var(--border-strong)'} strokeWidth={isHovered ? 2 : 1.2} />
              {isJoin && (
                <circle r={isHovered ? 14 : 11} fill="none" stroke="var(--brand-accent)" strokeOpacity={isHovered ? 0.6 : 0.35} strokeWidth={isHovered ? 2 : 1.5}>
                  <animate attributeName="r" values="11;18;11" dur="2.4s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
                </circle>
              )}
              <text x={9} dy="4"
                    style={{ font: `${isJoin ? '600' : '500'} 11.5px ui-monospace, monospace`, fill: isJoin ? 'var(--text-primary)' : 'var(--text-secondary)', pointerEvents: 'none' }}>
                {n.data.kind === 'symbol' && n.data.symbol ? n.data.symbol : n.data.name}
              </text>
            </g>
          )
        })}
      </g>
    </g>
  )
}

function JoinArrow({ active }: { active: boolean }) {
  const x1 = W * 0.4 + 20
  const x2 = W * 0.55 - 8
  const y = H / 2
  return (
    <g>
      <text x={(x1 + x2) / 2} y={y - 14} textAnchor="middle"
            style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--brand-accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        join at file
      </text>
      <path d={`M ${x1} ${y} Q ${(x1 + x2) / 2} ${y - 4}, ${x2} ${y}`}
            stroke="var(--brand-accent)" strokeWidth={active ? 2 : 1.5} strokeOpacity={active ? 1 : 0.55}
            fill="none" strokeDasharray={active ? 'none' : '5 4'}
            markerEnd="url(#join-arrowhead)"
            style={{ transition: 'stroke-opacity 180ms ease' }} />
      <defs>
        <marker id="join-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--brand-accent)" />
        </marker>
      </defs>
    </g>
  )
}
