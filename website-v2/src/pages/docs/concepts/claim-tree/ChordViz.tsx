import { useMemo, useState } from 'react'
import * as d3 from 'd3'
import { CO_CLAIM_PAIRS } from './data'

/**
 * Replaces Mode G — chord diagram of file co-claim co-occurrence.
 *
 * Files that are frequently claimed in the same session form thick arcs
 * between them. Hover a file's group to highlight its connections; hover
 * a chord to highlight just that pair.
 */
const SIZE = 540
const INNER_R = SIZE / 2 - 90
const OUTER_R = INNER_R + 14

export function ChordViz() {
  const [hoveredGroup, setHoveredGroup] = useState<number | null>(null)
  const [hoveredChord, setHoveredChord] = useState<number | null>(null)

  const { names, matrix, palette } = useMemo(() => {
    const set = new Set<string>()
    for (const p of CO_CLAIM_PAIRS) { set.add(p.a); set.add(p.b) }
    const names = Array.from(set).sort()
    const idx = new Map(names.map((n, i) => [n, i]))
    const m = Array.from({ length: names.length }, () => Array(names.length).fill(0))
    for (const p of CO_CLAIM_PAIRS) {
      const i = idx.get(p.a)!
      const j = idx.get(p.b)!
      m[i][j] = p.weight
      m[j][i] = p.weight
    }
    // Color: ordinal mapping per file with a curated palette.
    const palette = d3.quantize(d3.interpolateRainbow, names.length).map((c) =>
      d3.cubehelix(c).darker(0.2).formatHex()
    )
    return { names, matrix: m, palette }
  }, [])

  const chord = useMemo(() => d3.chord().padAngle(0.05).sortSubgroups(d3.descending)(matrix), [matrix])
  const arc = d3.arc<d3.ChordGroup>().innerRadius(INNER_R).outerRadius(OUTER_R)
  const ribbon = d3.ribbon<d3.Chord, d3.ChordSubgroup>().radius(INNER_R)

  return (
    <div className="space-y-2">
      <div className="text-xs text-[var(--text-muted)]">Which files travel together · hover a file or chord to isolate</div>
      <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
        <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="block h-auto w-full" role="img" aria-label="Chord diagram of file co-claim relationships">
          {/* Chords */}
          <g>
            {chord.map((c, i) => {
              const active = hoveredChord === null && hoveredGroup === null
              const matchesGroup = hoveredGroup !== null && (c.source.index === hoveredGroup || c.target.index === hoveredGroup)
              const matchesChord = hoveredChord === i
              const op = active ? 0.55 : (matchesGroup || matchesChord ? 0.9 : 0.08)
              const fill = palette[c.source.index]
              return (
                <path key={i}
                      d={ribbon(c) ?? ''}
                      fill={fill}
                      fillOpacity={op}
                      stroke="var(--surface-base)"
                      strokeWidth={0.5}
                      onMouseEnter={() => setHoveredChord(i)}
                      onMouseLeave={() => setHoveredChord(null)}
                      style={{ cursor: 'pointer', transition: 'fill-opacity 180ms ease' }} />
              )
            })}
          </g>
          {/* Arcs + labels */}
          {chord.groups.map((g, i) => {
            const angle = (g.startAngle + g.endAngle) / 2
            const labelR = OUTER_R + 10
            const lx = Math.sin(angle) * labelR
            const ly = -Math.cos(angle) * labelR
            const rotate = (angle * 180 / Math.PI) - 90
            const flip = angle > Math.PI
            const textAnchor: 'start' | 'end' = flip ? 'end' : 'start'
            const isHovered = hoveredGroup === i
            return (
              <g key={i}
                 onMouseEnter={() => setHoveredGroup(i)}
                 onMouseLeave={() => setHoveredGroup(null)}
                 style={{ cursor: 'pointer' }}>
                <path d={arc(g) ?? ''} fill={palette[i]} fillOpacity={isHovered ? 1 : 0.8}
                      stroke="var(--surface-base)" strokeWidth={1.5} />
                <text x={lx} y={ly} transform={`rotate(${flip ? rotate + 180 : rotate}, ${lx}, ${ly})`}
                      textAnchor={textAnchor} dominantBaseline="middle"
                      style={{ font: `${isHovered ? '700' : '500'} 11.5px ui-monospace, monospace`, fill: 'var(--text-primary)' }}>
                  {names[i]}
                </text>
              </g>
            )
          })}
          {/* Center label */}
          <text textAnchor="middle" y={-8} style={{ font: '600 13px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-primary)' }}>co-claim chord</text>
          <text textAnchor="middle" y={10} style={{ font: '500 10px ui-sans-serif, system-ui, sans-serif', fill: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>files claimed together</text>
        </svg>
      </div>
    </div>
  )
}
