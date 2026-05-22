import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { generateCalendar } from './data'

/**
 * Mode H — calendar heatmap with smooth sequential color scale, real
 * month/day tick labels, and per-cell tooltip. Inspired by GitHub's
 * contributions graph.
 */
const W = 880
const H = 200
const CELL = 22
const GAP = 2
const MARGIN = { top: 36, right: 60, bottom: 28, left: 56 }

export function CalendarViz() {
  const days = useMemo(() => generateCalendar(), [])
  const [hovered, setHovered] = useState<number | null>(null)

  const maxCount = d3.max(days, d => d.count) ?? 1
  const color = d3.scaleSequential<string>()
    .domain([0, maxCount])
    .interpolator(d3.interpolateRgbBasis(['var(--surface-raised)', '#fed7aa', '#f97316', '#b45309']))

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Lay out: rows = day-of-week, columns = week index.
  // Convert each day's date to (week, dow) coordinates.
  const earliest = days[0].date
  const cells = days.map((d, i) => {
    const daysFromStart = Math.floor((+d.date - +earliest) / 86_400_000)
    const dowZero = (earliest.getDay() + 6) % 7   // shift so Monday = 0
    const positional = daysFromStart + dowZero
    const week = Math.floor(positional / 7)
    const dow = positional % 7
    return { ...d, i, week, dow }
  })

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">28-day window · hover any day for top-claimed nodes</div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Calendar heatmap of claim activity">
          {/* Day-of-week labels */}
          {dayLabels.map((d, i) => (
            <text key={d} x={MARGIN.left - 8} y={MARGIN.top + i * (CELL + GAP) + CELL / 2 + 4}
                  textAnchor="end"
                  style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>
              {d}
            </text>
          ))}
          {/* Cells */}
          {cells.map(cell => {
            const x = MARGIN.left + cell.week * (CELL + GAP)
            const y = MARGIN.top + cell.dow * (CELL + GAP)
            const isToday = cell.i === days.length - 1
            const isHovered = hovered === cell.i
            const fill = color(cell.count)
            return (
              <g key={cell.i}>
                <rect x={x} y={y} width={CELL} height={CELL}
                      fill={fill}
                      stroke={isHovered ? 'var(--text-primary)' : isToday ? 'var(--brand-accent)' : 'var(--border-soft)'}
                      strokeWidth={isHovered || isToday ? 1.5 : 0.5}
                      onMouseEnter={() => setHovered(cell.i)}
                      onMouseLeave={() => setHovered(null)}
                      style={{ cursor: 'pointer', transition: 'stroke 120ms ease' }} />
                {isToday && (
                  <text x={x + CELL / 2} y={y - 6} textAnchor="middle"
                        style={{ font: '600 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--brand-accent)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    today
                  </text>
                )}
              </g>
            )
          })}
          {/* Month labels (top) */}
          <MonthLabels cells={cells} top={MARGIN.top - 24} cellSize={CELL + GAP} marginLeft={MARGIN.left} />
          {/* Legend */}
          <g transform={`translate(${MARGIN.left}, ${H - 14})`}>
            <text x={-8} y={4} textAnchor="end" style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>less</text>
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
              <rect key={i} x={i * 18} y={-4} width={14} height={10} fill={color(p * maxCount)} stroke="var(--border-soft)" strokeWidth={0.5} />
            ))}
            <text x={5 * 18} y={4} style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>more</text>
          </g>
          {/* Tooltip */}
          {hovered != null && (
            <CalendarTooltip day={days[hovered]} x={MARGIN.left + cells[hovered].week * (CELL + GAP)} y={MARGIN.top + cells[hovered].dow * (CELL + GAP)} W={W} />
          )}
        </svg>
      </div>
    </div>
  )
}

function MonthLabels({ cells, top, cellSize, marginLeft }: any) {
  // Find first cell of each month.
  const seen = new Set<string>()
  const labels: Array<{ month: string; week: number }> = []
  for (const c of cells) {
    const key = `${c.date.getFullYear()}-${c.date.getMonth()}`
    if (!seen.has(key)) {
      seen.add(key)
      labels.push({ month: d3.timeFormat('%b')(c.date), week: c.week })
    }
  }
  return (
    <g>
      {labels.map((l: any, i: number) => (
        <text key={i} x={marginLeft + l.week * cellSize} y={top}
              style={{ font: '600 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {l.month}
        </text>
      ))}
    </g>
  )
}

function CalendarTooltip({ day, x, y, W }: any) {
  const TW = 200
  const xx = Math.min(W - TW - 4, x + 8)
  const yy = Math.max(0, y - 56)
  const fmt = d3.timeFormat('%a %b %-d')
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={xx} y={yy} width={TW} height={50} fill="var(--surface-base)" stroke="var(--border-strong)" strokeWidth={1.5} />
      <text x={xx + 8} y={yy + 18} style={{ font: '600 12px ui-monospace, monospace', fill: 'var(--text-primary)' }}>
        {fmt(day.date)}
      </text>
      <text x={xx + 8} y={yy + 34} style={{ font: '500 11px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)' }}>
        {day.count} claim event{day.count === 1 ? '' : 's'}
      </text>
    </g>
  )
}
