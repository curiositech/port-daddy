import { useState } from 'react'

/**
 * Interactive MGL compatibility matrix.
 *
 * Hover or click a row mode → the columns that are compatible glow green,
 * the incompatible ones are dimmed red. Hover the upper-left cell to reset.
 *
 * Mirrors Gray (1976) compatibility table.
 */

const MODES = ['S', 'X', 'IS', 'IX', 'SIX'] as const
type Mode = (typeof MODES)[number]

const FULL: Record<Mode, { name: string; desc: string }> = {
  S:   { name: 'shared',                       desc: "I'll read this; others may read too" },
  X:   { name: 'exclusive',                    desc: "I'm writing this; nobody else should" },
  IS:  { name: 'intention-shared',             desc: "I have S on a descendant" },
  IX:  { name: 'intention-exclusive',          desc: "I have X on a descendant" },
  SIX: { name: 'shared + intention-exclusive', desc: 'S on this node + X somewhere below' },
}

// Compatibility matrix (row mode currently held; column mode being requested).
// true = both modes can coexist on the same node.
const COMPAT: Record<Mode, Record<Mode, boolean>> = {
  S:   { S: true,  X: false, IS: true,  IX: false, SIX: false },
  X:   { S: false, X: false, IS: false, IX: false, SIX: false },
  IS:  { S: true,  X: false, IS: true,  IX: true,  SIX: true  },
  IX:  { S: false, X: false, IS: true,  IX: true,  SIX: false },
  SIX: { S: false, X: false, IS: true,  IX: false, SIX: false },
}

export function ModesMatrixViz() {
  const [activeRow, setActiveRow] = useState<Mode | null>(null)

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        {/* Matrix */}
        <div className="overflow-x-auto border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-3">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-24 p-2 text-left">
                  <button type="button" onClick={() => setActiveRow(null)}
                          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    held ↓ / requested →
                  </button>
                </th>
                {MODES.map(m => (
                  <th key={m} className="px-2 py-2">
                    <div className="font-mono text-base font-bold text-[var(--text-primary)]">{m}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODES.map(rowMode => {
                const isActiveRow = activeRow === rowMode
                return (
                  <tr key={rowMode}
                      onMouseEnter={() => setActiveRow(rowMode)}
                      onMouseLeave={() => setActiveRow(null)}>
                    <th className={`p-2 text-left font-mono text-base ${isActiveRow ? 'text-[var(--text-primary)] font-bold' : 'text-[var(--text-secondary)]'}`}>
                      {rowMode}
                    </th>
                    {MODES.map(colMode => {
                      const compatible = COMPAT[rowMode][colMode]
                      const cellActive = isActiveRow
                      const bg = !cellActive
                        ? (compatible ? 'oklch(0.6 0.13 160 / 0.18)' : 'oklch(0.6 0.20 18 / 0.12)')
                        : (compatible ? 'oklch(0.62 0.16 160 / 0.85)' : 'oklch(0.6 0.22 18 / 0.80)')
                      const fg = cellActive ? 'var(--text-inverse)' : 'var(--text-secondary)'
                      return (
                        <td key={colMode}
                            className="border border-[var(--border-soft)] px-2 py-3 text-center text-base font-bold"
                            style={{ backgroundColor: bg, color: fg, transition: 'background-color 180ms ease, color 180ms ease' }}>
                          {compatible ? '✓' : '✗'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Detail / legend panel */}
        <aside className="space-y-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4">
          {activeRow ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Holding mode
              </div>
              <div className="font-mono text-2xl font-bold text-[var(--text-primary)]">{activeRow}</div>
              <div className="font-mono text-sm text-[var(--text-secondary)]">{FULL[activeRow].name}</div>
              <div className="text-sm text-[var(--text-secondary)]">
                <em className="text-[var(--text-primary)]">&ldquo;{FULL[activeRow].desc}&rdquo;</em>
              </div>
              <div className="space-y-1 border-t border-[var(--border-soft)] pt-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Allows</div>
                <div className="flex flex-wrap gap-1">
                  {MODES.filter(m => COMPAT[activeRow][m]).map(m => (
                    <span key={m} className="border border-[oklch(0.62_0.13_160)] bg-[oklch(0.62_0.13_160_/_0.18)] px-2 py-0.5 font-mono text-xs font-bold text-[oklch(0.4_0.13_160)]">
                      {m}
                    </span>
                  ))}
                  {MODES.filter(m => COMPAT[activeRow][m]).length === 0 && (
                    <span className="text-xs text-[var(--text-muted)]">(nothing — exclusive)</span>
                  )}
                </div>
              </div>
              <div className="space-y-1 border-t border-[var(--border-soft)] pt-3 text-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Blocks</div>
                <div className="flex flex-wrap gap-1">
                  {MODES.filter(m => !COMPAT[activeRow][m]).map(m => (
                    <span key={m} className="border border-[oklch(0.6_0.20_18)] bg-[oklch(0.6_0.20_18_/_0.12)] px-2 py-0.5 font-mono text-xs font-bold text-[oklch(0.5_0.20_18)]">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-2 text-sm text-[var(--text-secondary)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Mode reference</div>
              {MODES.map(m => (
                <div key={m} className="grid grid-cols-[28px_1fr] gap-2">
                  <span className="font-mono text-base font-bold text-[var(--text-primary)]">{m}</span>
                  <span className="text-[13px]">{FULL[m].name} — <em className="text-[var(--text-muted)]">{FULL[m].desc}</em></span>
                </div>
              ))}
              <div className="border-t border-[var(--border-soft)] pt-2 text-xs text-[var(--text-muted)]">
                Hover any row to highlight its compatibility row.
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
