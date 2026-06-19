import { useMemo, useState } from 'react'
import { sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey'
import { SANKEY_FLOWS } from './data'

/**
 * Mode I — actual Sankey via d3-sankey. Sources on the left (claim
 * creation), destinations on the right (claim resolution). Real flow
 * conservation, real layout algorithm. Hover a band to highlight its
 * source-destination pair.
 */
const W = 880
const H = 340
const MARGIN = { top: 12, right: 130, bottom: 12, left: 130 }

interface SNode { name: string; category: 'source' | 'destination' }
interface SLink { source: string; target: string; value: number }

const NODE_COLOR: Record<string, string> = {
  'pd add':                  'oklch(0.66 0.18 282)',
  'pd feature':              'oklch(0.66 0.20 35)',
  'auto-escalation':         'oklch(0.6 0.13 215)',
  'pd done':                 'oklch(0.62 0.13 160)',
  'reverted':                'oklch(0.7 0.16 75)',
  'pruned under contest':    'oklch(0.6 0.20 18)',
}

export function SankeyViz() {
  const [hovered, setHovered] = useState<number | null>(null)

  const { nodes, links } = useMemo(() => {
    const nodeNames = Array.from(new Set([...SANKEY_FLOWS.map(f => f.source), ...SANKEY_FLOWS.map(f => f.target)]))
    const sources = new Set(SANKEY_FLOWS.map(f => f.source))
    const rawNodes: SNode[] = nodeNames.map(name => ({
      name,
      category: sources.has(name) ? 'source' : 'destination',
    }))
    const rawLinks: SLink[] = SANKEY_FLOWS.map(f => ({ ...f }))

    const sk = sankey<SNode, SLink>()
      .nodeId((d: SNode) => d.name)
      .nodeAlign(sankeyLeft)
      .nodeWidth(14)
      .nodePadding(18)
      .extent([[MARGIN.left, MARGIN.top], [W - MARGIN.right, H - MARGIN.bottom]])

    return sk({ nodes: rawNodes.map(d => ({ ...d })), links: rawLinks.map(d => ({ ...d })) })
  }, [])

  const totalIn = SANKEY_FLOWS.reduce((acc, f) => acc + f.value, 0)

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">{totalIn} claims sampled · hover a band to isolate its flow</div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Sankey flow of claim lifecycle">
          {/* Links */}
          <g fill="none">
            {links.map((l: any, i: number) => {
              const path = sankeyLinkHorizontal()(l as any) ?? ''
              const srcColor = NODE_COLOR[(l.source as any).name] ?? 'var(--brand-accent)'
              const isHovered = hovered === i
              return (
                <path key={i} d={path}
                      stroke={srcColor}
                      strokeWidth={Math.max(1, l.width ?? 1)}
                      strokeOpacity={hovered === null ? 0.45 : isHovered ? 0.9 : 0.1}
                      style={{ transition: 'stroke-opacity 180ms ease' }}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)} />
              )
            })}
          </g>
          {/* Nodes */}
          <g>
            {nodes.map((n: any, i: number) => {
              const color = NODE_COLOR[n.name] ?? 'var(--brand-accent)'
              return (
                <g key={i}>
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={(n.y1 ?? 0) - (n.y0 ?? 0)}
                        fill={color} stroke="var(--surface-base)" strokeWidth={2} />
                  <text x={n.category === 'source' ? n.x0! - 6 : n.x1! + 6}
                        y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2 + 4}
                        textAnchor={n.category === 'source' ? 'end' : 'start'}
                        style={{ font: '600 12px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-primary)' }}>
                    {n.name}
                  </text>
                  <text x={n.category === 'source' ? n.x0! - 6 : n.x1! + 6}
                        y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2 + 19}
                        textAnchor={n.category === 'source' ? 'end' : 'start'}
                        style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {n.value} ({Math.round((n.value ?? 0) / totalIn * 100)}%)
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
