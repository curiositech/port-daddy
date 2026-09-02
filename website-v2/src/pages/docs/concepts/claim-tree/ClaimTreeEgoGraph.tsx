import { useEffect, useMemo, useState } from 'react'
import { Mermaid } from '@/components/ui/Mermaid'
import { cn } from '@/lib/utils'
import {
  renderClaimTreeTroubleMermaid,
  type ClaimTreeTroubleState,
} from '../../../../../../lib/claim-tree-trouble'

export interface ClaimTreeTroubleStateMeta {
  state: ClaimTreeTroubleState
  label: string
  reason: string
  action: string
  color: string
}

export const CLAIM_TREE_TROUBLE_STATES: readonly ClaimTreeTroubleStateMeta[] = [
  {
    state: 'VERIFY',
    label: 'Verify provenance',
    reason: 'claim provenance is incomplete or names different worlds',
    action: 'refresh the claim tree and compare the intended merge world before editing',
    color: '#2563EB',
  },
  {
    state: 'RESCUE',
    label: 'Rescue stale claim',
    reason: 'the counterpart claim is no longer backed by a live session',
    action: 'inspect salvage or handoff evidence before reclaiming the surface',
    color: '#D97706',
  },
  {
    state: 'COORDINATE',
    label: 'Coordinate overlap',
    reason: 'two live sessions claim the same declared surface',
    action: 'open a parley, hand off, or split the surface before proceeding',
    color: '#C026D3',
  },
  {
    state: 'INSPECT',
    label: 'Inspect precision',
    reason: 'the shared surface lacks symbol or complete range precision',
    action: 'resolve symbols or ranges, then re-scan before editing',
    color: '#0891B2',
  },
  {
    state: 'RECONCILE',
    label: 'Reconcile freshness',
    reason: 'the claim tree is older than its freshness boundary',
    action: 'refresh provenance and reconcile the claim with current work',
    color: '#0F766E',
  },
  {
    state: 'WATCH',
    label: 'Watch dependency',
    reason: 'a dependency connects otherwise separate claimed surfaces',
    action: 'proceed with a narrow change and watch the dependent surface',
    color: '#EA580C',
  },
  {
    state: 'PROCEED',
    label: 'Proceed',
    reason: 'no trouble is visible in the supplied evidence',
    action: 'proceed, keeping the claim current',
    color: '#334155',
  },
] as const

const TROUBLE_STATE_MAP: Record<ClaimTreeTroubleState, ClaimTreeTroubleStateMeta> =
  Object.fromEntries(CLAIM_TREE_TROUBLE_STATES.map((state) => [state.state, state])) as Record<
    ClaimTreeTroubleState,
    ClaimTreeTroubleStateMeta
  >

const DEFAULT_STATE: ClaimTreeTroubleState = 'COORDINATE'

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    if (media.addEventListener) {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }
    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [])

  return reduced
}

function stateClassName(state: ClaimTreeTroubleState) {
  return `claimtreeState${state[0]}${state.slice(1).toLowerCase()}`
}

function buildTroubleMermaid(state: ClaimTreeTroubleState) {
  const meta = TROUBLE_STATE_MAP[state]
  // Mermaid's flowchart grammar rejects CSS var() inside classDef/linkStyle
  // values (parse error at "(-"), so only literal colors may appear below.
  // The actor and surface nodes take the Mermaid card's theme-independent
  // paper styling from themeVariables; the state node and its edge carry the
  // one semantic state color.
  return [
    renderClaimTreeTroubleMermaid({
      filePath: 'lib/auth.ts',
      selfSessionId: 'session-you',
      otherSessionId: 'session-other',
      state,
    }),
    `classDef ${stateClassName(state)} fill:${meta.color},stroke:${meta.color},stroke-width:3px,color:#ffffff;`,
    `class STATE ${stateClassName(state)};`,
    `linkStyle 2 stroke:${meta.color},stroke-width:2.5px;`,
  ].join('\n')
}

/**
 * Interactive claim-tree trouble visualizer.
 *
 * The Mermaid graph stays intentionally bounded: one shared file, two claims,
 * one current state. The state legend and inspection panel make the reason and
 * next action explicit without turning the graph into a scoreboard.
 */
export function ClaimTreeEgoGraph() {
  const reducedMotion = usePrefersReducedMotion()
  const [selectedState, setSelectedState] = useState<ClaimTreeTroubleState>(DEFAULT_STATE)
  const selected = TROUBLE_STATE_MAP[selectedState]

  const chart = useMemo(() => buildTroubleMermaid(selectedState), [selectedState])

  return (
    <figure
      data-testid="claimtree-trouble-viz"
      data-motion={reducedMotion ? 'reduced' : 'full'}
      data-selected-state={selectedState}
      className="space-y-4"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.8fr)]">
        <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-3 sm:p-4">
          <Mermaid
            chart={chart}
            flowchartHtmlLabels={false}
            className="my-0 border-0 bg-transparent p-0 shadow-none"
          />
        </div>

        <aside className="space-y-4 border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-4 sm:p-5">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  State legend
                </div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Hover, focus, or click a state to change the inspection.
                </p>
              </div>
              <span className="font-mono text-xs uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                Ordered by precedence
              </span>
            </div>

            <div className="grid gap-2">
              {CLAIM_TREE_TROUBLE_STATES.map((meta) => {
                const active = selectedState === meta.state
                return (
                  <button
                    key={meta.state}
                    type="button"
                    aria-pressed={active}
                    aria-label={`${meta.state}: ${meta.label}. ${meta.action}`}
                    onMouseEnter={() => setSelectedState(meta.state)}
                    onFocus={() => setSelectedState(meta.state)}
                    onClick={() => setSelectedState(meta.state)}
                    className={cn(
                      'group flex w-full items-start gap-3 border-2 px-3 py-3 text-left',
                      reducedMotion
                        ? 'transition-none'
                        : 'transition-[background-color,border-color,box-shadow,transform] duration-200',
                      active
                        ? 'border-[var(--text-primary)] bg-[var(--surface-base)]'
                        : 'border-[var(--border-soft)] bg-[var(--surface-base)] hover:bg-[var(--surface-hover)]',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1 h-3 w-3 shrink-0 border border-[var(--border-strong)]"
                      style={{ backgroundColor: meta.color }}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-[var(--text-primary)]">
                          {meta.state}
                        </span>
                        {active ? (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                            selected
                          </span>
                        ) : null}
                      </span>
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">
                        {meta.label}
                      </span>
                      <span className="block text-sm leading-relaxed text-[var(--text-secondary)]">
                        {meta.action}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <section
            role="status"
            aria-live="polite"
            className="border-2 border-[var(--border-soft)] bg-[var(--surface-base)] p-4"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 border border-[var(--border-strong)]"
                style={{ backgroundColor: selected.color }}
              />
              <div className="space-y-1">
                <div className="font-mono text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  Inspection
                </div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                  {selected.label}
                </h3>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Why it appears:</span>{' '}
              {selected.reason}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              <span className="font-semibold text-[var(--text-primary)]">Action:</span>{' '}
              {selected.action}
            </p>
            <div className="mt-4 border-t border-[var(--border-soft)] pt-3 text-sm text-[var(--text-muted)]">
              Earlier states dominate later evidence. The Mermaid node and inspector
              stay in sync.
            </div>
          </section>
        </aside>
      </div>

      <figcaption className="border-t border-[var(--border-soft)] pt-3 text-sm text-[var(--text-secondary)]">
        Color is semantic only. The state label, reason, and next action stay
        visible together, and reduced motion keeps the swap instant.
      </figcaption>
    </figure>
  )
}
