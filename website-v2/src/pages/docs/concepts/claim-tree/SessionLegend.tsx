import { SESSIONS } from './data'
import { useHover } from './HoverContext'

/**
 * The shared legend at the top of the gallery — also the cross-viz hover
 * controller. Hovering a chip dims everything not belonging to that
 * session across every visualization on the page.
 */
export function SessionLegend() {
  const { session, setSession } = useHover()
  return (
    <div className="space-y-3 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        Three sessions active — hover a chip to highlight across every viz below
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {SESSIONS.map(s => {
          const active = session === s.id
          return (
            <button
              key={s.id}
              type="button"
              onMouseEnter={() => setSession(s.id)}
              onMouseLeave={() => setSession(null)}
              onFocus={() => setSession(s.id)}
              onBlur={() => setSession(null)}
              className={`group flex flex-col gap-1 border-2 p-3 text-left transition-all ${active ? 'border-[var(--text-primary)]' : 'border-[var(--border-soft)]'}`}
              style={{ backgroundColor: active ? `color-mix(in oklch, ${s.color} 18%, transparent)` : 'transparent' }}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 shrink-0" style={{ backgroundColor: s.color }} aria-hidden />
                <span className="font-mono text-sm text-[var(--text-primary)]">{s.id}</span>
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                <span className="font-semibold text-[var(--text-primary)]">{s.agent}</span>{' '}
                — {s.intent}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
