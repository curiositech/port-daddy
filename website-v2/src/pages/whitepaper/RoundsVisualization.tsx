/**
 * RoundsVisualization — visual layer over the dialogue artifacts.
 *
 * Three views:
 *   1. Coverage matrix: paper § (rows) × class (cols), cells colored by
 *      cumulative count of smells answered there. Operators see at a
 *      glance which sections of the paper are well-exercised vs.
 *      unprobed.
 *   2. Reputation ledger: per-persona running tally over rounds.
 *   3. Severity stack: per-round breakdown of high/medium/scope.
 *
 * Pure SVG, no chart library — keeps the bundle small and the design
 * consistent with Swiss-modern primitives.
 */

import * as React from 'react'
import { ROUNDS, type RoundDialogue } from '@/data/whitepaperRounds'

const SECTIONS = [
  'Anchor §2.4',
  'Anchor §3',
  'Bonded §4.2',
  'Bonded §4.3',
  'Bonded §7',
  'Bonded §7.4',
  'Bonded §7.x',
  'Bonded §8.3',
  'Bonded §8.4',
  'Bonded §9.2',
] as const

const CLASSES = [
  'crypto',
  'crypto+recovery',
  'econ',
  'coord',
  'recovery',
  'mechanism',
] as const

type SectionKey = typeof SECTIONS[number]
type ClassKey = typeof CLASSES[number]

function aggregateCoverage(): Record<SectionKey, Record<ClassKey, number>> {
  const matrix: Record<string, Record<string, number>> = {}
  for (const sec of SECTIONS) {
    matrix[sec] = {}
    for (const cls of CLASSES) matrix[sec][cls] = 0
  }
  for (const round of ROUNDS) {
    for (const ex of round.exchanges) {
      if (matrix[ex.section] && matrix[ex.section][ex.class] !== undefined) {
        matrix[ex.section][ex.class] += 1
      }
    }
  }
  return matrix as Record<SectionKey, Record<ClassKey, number>>
}

function severityCounts(round: RoundDialogue): { high: number; medium: number; scope: number } {
  let high = 0, medium = 0, scope = 0
  for (const ex of round.exchanges) {
    if (ex.severity === 'high') high++
    else if (ex.severity === 'medium') medium++
    else scope++
  }
  return { high, medium, scope }
}

function reputationLedger(): Array<{ persona: string; rounds: Array<{ round: string; delta: string }> }> {
  const personas = new Set<string>()
  for (const round of ROUNDS) {
    for (const p of Object.keys(round.reputation_deltas ?? {})) personas.add(p)
  }
  return Array.from(personas).sort().map((p) => ({
    persona: p,
    rounds: ROUNDS
      .filter((r) => r.reputation_deltas && p in r.reputation_deltas)
      .map((r) => ({ round: r.round_to, delta: (r.reputation_deltas as Record<string, string>)[p] })),
  }))
}

// ─── Coverage heatmap ──────────────────────────────────────────────────────

function Heatmap() {
  const matrix = aggregateCoverage()
  const cellSize = 36
  const labelLeft = 120
  const labelTop = 84
  const width = labelLeft + cellSize * CLASSES.length + 16
  const height = labelTop + cellSize * SECTIONS.length + 16

  // Find max for color scaling.
  let max = 0
  for (const sec of SECTIONS) for (const cls of CLASSES) {
    if (matrix[sec][cls] > max) max = matrix[sec][cls]
  }

  function fill(n: number): string {
    if (n === 0) return 'var(--surface-base)'
    const t = max === 0 ? 0 : n / max
    // Brand-primary at increasing alpha.
    const alpha = 0.15 + 0.7 * t
    return `color-mix(in oklab, var(--brand-primary) ${alpha * 100}%, transparent)`
  }

  return (
    <svg width={width} height={height} role="img" aria-label="Coverage heatmap: paper section by class">
      {/* Class headers (rotated) */}
      {CLASSES.map((cls, i) => (
        <text
          key={cls}
          x={labelLeft + i * cellSize + cellSize / 2}
          y={labelTop - 8}
          textAnchor="end"
          transform={`rotate(-50, ${labelLeft + i * cellSize + cellSize / 2}, ${labelTop - 8})`}
          fontSize={10}
          fill="var(--text-muted)"
        >
          {cls}
        </text>
      ))}
      {/* Section labels */}
      {SECTIONS.map((sec, j) => (
        <text
          key={sec}
          x={labelLeft - 8}
          y={labelTop + j * cellSize + cellSize / 2 + 3}
          textAnchor="end"
          fontSize={11}
          fill="var(--text-muted)"
        >
          {sec}
        </text>
      ))}
      {/* Cells */}
      {SECTIONS.flatMap((sec, j) =>
        CLASSES.map((cls, i) => {
          const n = matrix[sec][cls]
          return (
            <g key={`${sec}-${cls}`}>
              <rect
                x={labelLeft + i * cellSize}
                y={labelTop + j * cellSize}
                width={cellSize - 2}
                height={cellSize - 2}
                fill={fill(n)}
                stroke="var(--border-subtle)"
              />
              {n > 0 && (
                <text
                  x={labelLeft + i * cellSize + (cellSize - 2) / 2}
                  y={labelTop + j * cellSize + (cellSize - 2) / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-strong)"
                  fontWeight="600"
                >
                  {n}
                </text>
              )}
            </g>
          )
        }),
      )}
    </svg>
  )
}

// ─── Severity bar per round ────────────────────────────────────────────────

function SeverityStack() {
  const data = ROUNDS.map((r) => ({
    label: `${r.round_from}→${r.round_to}`,
    ...severityCounts(r),
  }))
  const barH = 28
  const gap = 14
  const labelLeft = 110
  const max = Math.max(1, ...data.map((d) => d.high + d.medium + d.scope))
  const scale = 320 / max
  const height = data.length * (barH + gap)

  return (
    <svg width={labelLeft + 360} height={height} role="img" aria-label="Severity by round">
      {data.map((d, i) => {
        const y = i * (barH + gap)
        const wHigh = d.high * scale
        const wMed = d.medium * scale
        const wScope = d.scope * scale
        return (
          <g key={d.label}>
            <text x={labelLeft - 10} y={y + barH / 2 + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {d.label}
            </text>
            <rect x={labelLeft} y={y} width={wHigh} height={barH} fill="var(--brand-primary)" />
            <rect x={labelLeft + wHigh} y={y} width={wMed} height={barH} fill="color-mix(in oklab, var(--brand-primary) 50%, transparent)" />
            <rect x={labelLeft + wHigh + wMed} y={y} width={wScope} height={barH} fill="color-mix(in oklab, var(--text-muted) 25%, transparent)" />
            <text
              x={labelLeft + wHigh + wMed + wScope + 8}
              y={y + barH / 2 + 4}
              fontSize={11}
              fill="var(--text-muted)"
            >
              {d.high} high · {d.medium} med · {d.scope} scope
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Reputation ledger ─────────────────────────────────────────────────────

function ReputationLedger() {
  const ledger = reputationLedger()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            <th className="px-3 py-2 text-left text-[var(--text-muted)] font-normal">Persona</th>
            {ROUNDS.map((r) => (
              <th key={r.round_to} className="px-3 py-2 text-left text-[var(--text-muted)] font-normal">
                v{r.round_to.replace(/^v/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.map(({ persona, rounds }) => (
            <tr key={persona} className="border-b border-[var(--border-subtle)] last:border-0">
              <td className="px-3 py-2 font-mono text-[var(--text-strong)]">{persona}</td>
              {ROUNDS.map((r) => {
                const entry = rounds.find((x) => x.round === r.round_to)
                return (
                  <td key={r.round_to} className="px-3 py-2 text-[var(--text-muted)]">
                    {entry ? entry.delta : '—'}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Top-level visualization panel ─────────────────────────────────────────

export function RoundsVisualization(): React.ReactElement {
  return (
    <div className="grid gap-[var(--space-6)] lg:grid-cols-2">
      <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)] lg:col-span-2">
        <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
          Coverage matrix
        </h3>
        <p className="mb-[var(--space-4)] max-w-[64ch] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          Each cell is one paper section crossed with one kind of complaint
          (cryptography, economics, recovery, and so on). Filled cells have
          been argued over; empty ones are surfaces no reviewer has
          stress-tested yet.
        </p>
        <div className="overflow-x-auto">
          <Heatmap />
        </div>
      </section>

      <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
        <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
          Severity, round by round
        </h3>
        <p className="mb-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          Filled bars are deep flaws; half-tones are weaker objections;
          muted bars are scope clarifications. A round that was mostly
          muted means the paper held up that month.
        </p>
        <div className="overflow-x-auto">
          <SeverityStack />
        </div>
      </section>

      <section className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-5)]">
        <h3 className="mb-[var(--space-2)] font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
          Who pushed what
        </h3>
        <p className="mb-[var(--space-4)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          Each reviewer persona earns or loses points per round depending on
          whether their objection landed. Negative entries are the times we
          decided a critique was wrong on the merits.
        </p>
        <ReputationLedger />
      </section>
    </div>
  )
}
