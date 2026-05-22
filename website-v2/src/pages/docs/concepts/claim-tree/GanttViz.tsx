import { useMemo, useState, useRef } from 'react'
import * as d3 from 'd3'
import { GANTT_SPANS, SESSIONS, type SessionId } from './data'
import { useHover, dimFor } from './HoverContext'

/**
 * Mode F — claim timeline.
 *
 * Each session gets a swim lane; each claim is a rounded bar on a d3
 * time scale. Real tick formatting (no floating-point garbage). Hover a
 * bar → tooltip with start/end/duration. The "NOW" rule is a dashed
 * line that subtly pulses.
 */
const W = 900
const H = 280
const MARGIN = { top: 16, right: 88, bottom: 32, left: 110 }

export function GanttViz() {
  const { session: hovered, setSession, setNodeId, nodeId: hoveredNodeId } = useHover()

  const innerW = W - MARGIN.left - MARGIN.right
  const innerH = H - MARGIN.top - MARGIN.bottom

  // Domain: from earliest spawn (most-negative startedAt) to NOW (0)
  const minT = useMemo(() => d3.min(GANTT_SPANS, s => s.start) ?? -30 * 60_000, [])
  const x = useMemo(() => d3.scaleTime().domain([new Date(minT), new Date(0)]).range([0, innerW]).nice(), [innerW, minT])
  const y = useMemo(() => d3.scaleBand<SessionId>().domain(SESSIONS.map(s => s.id)).range([0, innerH]).padding(0.25), [innerH])

  const tickFmt = d3.timeFormat('%-Mm')
  const ticks = x.ticks(6)

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">Hover a bar for details · drag NOT YET</div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Per-session Gantt ribbon">
          <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
            {/* Grid */}
            {ticks.map((t, i) => (
              <line key={i} x1={x(t)} x2={x(t)} y1={0} y2={innerH} stroke="var(--border-soft)" strokeWidth={1} strokeDasharray="2 4" />
            ))}
            {/* Lane backgrounds + labels */}
            {SESSIONS.map((s) => (
              <g key={s.id}>
                <rect x={0} y={y(s.id)!} width={innerW} height={y.bandwidth()}
                      fill={hovered === s.id ? `color-mix(in oklch, ${s.color} 15%, transparent)` : 'transparent'}
                      style={{ transition: 'fill 180ms ease' }} />
                <foreignObject x={-MARGIN.left + 8} y={y(s.id)! + 4} width={MARGIN.left - 12} height={y.bandwidth()}>
                  <button type="button"
                          onMouseEnter={() => setSession(s.id)} onMouseLeave={() => setSession(null)}
                          className="block w-full text-left text-[12px] leading-tight">
                    <div className="font-semibold text-[var(--text-primary)]">{s.id.replace('session-', '')}</div>
                    <div className="text-[var(--text-muted)]">{s.agent}</div>
                  </button>
                </foreignObject>
              </g>
            ))}

            {/* NOW line */}
            <line x1={x(new Date(0))} x2={x(new Date(0))} y1={-6} y2={innerH} stroke="var(--brand-accent)" strokeWidth={1.5} strokeDasharray="3 3">
              <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="2.4s" repeatCount="indefinite" />
            </line>
            <text x={x(new Date(0)) + 4} y={-4}
                  style={{ font: '600 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--brand-accent)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              now
            </text>

            {/* Spans */}
            {GANTT_SPANS.map((sp, i) => {
              const s = SESSIONS.find(x2 => x2.id === sp.session)!
              const x0 = x(new Date(sp.start))
              const x1 = x(new Date(sp.end))
              const yb = y(sp.session)!
              const lh = y.bandwidth() * 0.55
              const ymid = yb + (y.bandwidth() - lh) / 2
              const isHover = hoveredNodeId === sp.nodeId
              const op = dimFor(sp.session, hovered)
              return (
                <g key={i}
                   onMouseEnter={() => { setSession(sp.session); setNodeId(sp.nodeId) }}
                   onMouseLeave={() => { setSession(null); setNodeId(null) }}
                   style={{ cursor: 'pointer' }}>
                  <rect x={x0} y={ymid} width={Math.max(2, x1 - x0)} height={lh}
                        rx={3} ry={3}
                        fill={s.color} fillOpacity={op}
                        stroke={isHover ? 'var(--text-primary)' : 'transparent'} strokeWidth={1.5}
                        style={{ transition: 'fill-opacity 180ms ease, stroke 120ms ease' }} />
                  {x1 - x0 > 100 && (
                    <text x={x0 + 8} y={ymid + lh / 2 + 4}
                          style={{ font: '600 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-inverse)', pointerEvents: 'none' }}>
                      {sp.label}
                    </text>
                  )}
                  {isHover && <SpanTooltip sp={sp} x0={x0} y={ymid - 10} innerW={innerW} s={s} x={x} />}
                </g>
              )
            })}

            {/* X axis */}
            <line x1={0} x2={innerW} y1={innerH + 2} y2={innerH + 2} stroke="var(--border-strong)" strokeWidth={1} />
            {ticks.map((t, i) => {
              const ms = +t
              const label = ms === 0 ? 'now' : `${Math.round(ms / 60_000)}m`
              return (
                <g key={i} transform={`translate(${x(t)}, ${innerH + 2})`}>
                  <line y2={4} stroke="var(--border-strong)" />
                  <text textAnchor="middle" y={18} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>{label}</text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}

function SpanTooltip({ sp, x0, y, innerW, s }: any) {
  const w = 220
  const h = 56
  const room = 6
  const xx = Math.min(innerW - w, Math.max(0, x0))
  // y here is the top of the bar (ymid). Flip below the bar when the bar
  // sits near the top of the SVG.
  const wantsAbove = y > h + room + 2
  const top = wantsAbove ? y - h - room : y + 22 + room
  const dur = Math.abs(sp.start - sp.end) / 60_000
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={xx} y={top} width={w} height={h} fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth={1.5} />
      <text x={xx + 8} y={top + 18} style={{ font: '600 12px ui-monospace, monospace', fill: 'var(--text-primary)' }}>{sp.label}</text>
      <text x={xx + 8} y={top + 34} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: s.color }}>{s.agent}</text>
      <text x={xx + 8} y={top + 50} style={{ font: '400 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>{Math.round(dur)} min</text>
    </g>
  )
}
