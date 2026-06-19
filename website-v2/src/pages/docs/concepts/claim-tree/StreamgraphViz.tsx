import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { STREAM_LAYERS, STREAM_TIME_BUCKETS } from './data'

/**
 * Mode J — streamgraph with d3.stackOffsetWiggle baseline and
 * d3.curveBasis smooth curves. Hovering reveals a vertical guide and
 * per-layer values at that time bucket.
 */
const W = 880
const H = 320
const MARGIN = { top: 12, right: 96, bottom: 28, left: 16 }

interface Row { t: number; [k: string]: number }

export function StreamgraphViz() {
  const [hoverX, setHoverX] = useState<number | null>(null)

  const data: Row[] = STREAM_TIME_BUCKETS

  const innerW = W - MARGIN.left - MARGIN.right
  const innerH = H - MARGIN.top - MARGIN.bottom

  const keys = STREAM_LAYERS.map(l => l.key)

  const stack = useMemo(() => d3.stack<Row>().keys(keys).offset(d3.stackOffsetWiggle).order(d3.stackOrderInsideOut)(data), [data, keys])

  const x = useMemo(() => d3.scaleLinear().domain(d3.extent(data, d => d.t) as [number, number]).range([0, innerW]), [innerW, data])
  const yExtent: [number, number] = [
    d3.min(stack, s => d3.min(s, p => p[0])) ?? 0,
    d3.max(stack, s => d3.max(s, p => p[1])) ?? 0,
  ]
  const y = d3.scaleLinear().domain(yExtent).range([innerH, 0])

  const area = d3.area<d3.SeriesPoint<Row>>()
    .x((d, _i) => x(d.data.t))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]))
    .curve(d3.curveBasis)

  // Time tick labels.
  const ticks = data.map(d => d.t)
  const formatTick = (ms: number) => {
    if (ms === 0) return 'now'
    const h = Math.abs(ms / 3600_000)
    return `-${h}h`
  }

  // For the hover guide: find the closest data index.
  const hoverIndex = hoverX != null ? closestIndex(data, x.invert(hoverX - MARGIN.left)) : null

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">Hover for per-layer breakdown at that moment</div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg
          viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full"
          onMouseMove={(e) => {
            const svg = e.currentTarget
            const rect = svg.getBoundingClientRect()
            const fx = (e.clientX - rect.left) * (W / rect.width)
            setHoverX(fx)
          }}
          onMouseLeave={() => setHoverX(null)}
          role="img" aria-label="Streamgraph of claim depth over time"
        >
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Layers */}
            {stack.map((series, i) => {
              const layer = STREAM_LAYERS[i]
              return (
                <path key={layer.key} d={area(series) ?? ''} fill={layer.color} stroke="none" />
              )
            })}
            {/* Right-side layer labels */}
            {stack.map((series, i) => {
              const last = series[series.length - 1]
              const layer = STREAM_LAYERS[i]
              return (
                <text key={layer.key}
                      x={innerW + 6}
                      y={y((last[0] + last[1]) / 2)}
                      style={{ font: '600 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-primary)' }}
                      dy="0.35em">
                  {layer.label}
                </text>
              )
            })}
            {/* X-axis */}
            <line x1={0} x2={innerW} y1={innerH + 2} y2={innerH + 2} stroke="var(--border-strong)" />
            {ticks.map((t, i) => (
              <g key={i} transform={`translate(${x(t)}, ${innerH + 2})`}>
                <line y2={4} stroke="var(--border-strong)" />
                <text textAnchor="middle" y={18} style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>{formatTick(t)}</text>
              </g>
            ))}
            {/* Hover guide + tooltip */}
            {hoverIndex != null && (
              <HoverGuide
                index={hoverIndex} data={data} stack={stack} x={x} y={y} innerW={innerW} innerH={innerH}
              />
            )}
          </g>
        </svg>
      </div>
    </div>
  )
}

function closestIndex(data: Row[], t: number): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < data.length; i++) {
    const d = Math.abs(data[i].t - t)
    if (d < bestDist) { best = i; bestDist = d }
  }
  return best
}

function HoverGuide({ index, data, stack, x, y, innerW, innerH }: any) {
  const row: Row = data[index]
  const guideX = x(row.t)
  const total = STREAM_LAYERS.reduce((acc, l) => acc + (row[l.key] as number), 0)
  const tooltipX = Math.min(innerW - 200, guideX + 12)
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={guideX} x2={guideX} y1={0} y2={innerH} stroke="var(--text-primary)" strokeWidth={1.2} strokeDasharray="3 3" />
      {/* Dots per layer at the upper edge of that series */}
      {stack.map((series: any, i: number) => {
        const p = series[index]
        if (!p) return null
        return (
          <circle key={i} cx={guideX} cy={y((p[0] + p[1]) / 2)} r={3.5}
                  fill={STREAM_LAYERS[i].color} stroke="var(--text-primary)" strokeWidth={1} />
        )
      })}
      {/* Tooltip */}
      <rect x={tooltipX} y={6} width={188} height={STREAM_LAYERS.length * 18 + 26}
            fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth={1.5} />
      <text x={tooltipX + 8} y={22} style={{ font: '600 12px ui-monospace, monospace', fill: 'var(--text-primary)' }}>
        {row.t === 0 ? 'NOW' : `${row.t / 3600_000}h`} · {total} claims
      </text>
      {STREAM_LAYERS.map((layer, i) => (
        <g key={layer.key} transform={`translate(${tooltipX + 8}, ${36 + i * 18})`}>
          <rect width={10} height={10} fill={layer.color} />
          <text x={16} y={9} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-primary)' }}>{layer.label}</text>
          <text x={170} y={9} textAnchor="end" style={{ font: '600 11px ui-monospace, monospace', fill: 'var(--text-primary)' }}>{row[layer.key]}</text>
        </g>
      ))}
    </g>
  )
}
