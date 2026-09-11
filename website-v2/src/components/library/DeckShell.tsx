import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

/**
 * The deck: one screen, no page scroll, content behind sub-menus.
 *
 * Both library routes used to be a single tall column — hero, then spine,
 * then climb, then architecture, then reading paths, then status, then
 * references — which meant the third screenful was doing the work of a
 * navigation menu with none of the affordances of one, and the reader paid
 * for it in scrolling. The content did not need to go; it needed to stop
 * being a queue.
 *
 * So: the page is exactly the viewport. A rail of signals selects one panel,
 * the panel swaps under it, and any overflow scrolls INSIDE its own panel
 * rather than moving the page. The colour block belongs to the selected
 * signal and floods the panel head, which is how you know where you are
 * without reading the rail again.
 *
 * Motion is short on purpose: 170ms with a small spring on the incoming
 * panel. Long enough to read as a swap rather than a repaint, short enough
 * that a reader clicking through four parts never waits on it. Under
 * prefers-reduced-motion the swap is instant and the stripe simply moves.
 */

export interface DeckSignal {
  /** Stable id; also the URL's ?panel= value, so a panel is linkable. */
  id: string
  /** Rail label. Short — this is a tab, not a sentence. */
  label: string
  /** ICS flag class from styles/signal-flags.css, e.g. 'fl-papa'. */
  flag: string
  /**
   * What the flag actually means in Pub. 102. Shown on the rail's tooltip
   * and read out to assistive tech, because a flag nobody can decode is
   * decoration and this system does not ship decoration.
   */
  meaning: string
  /** CSS colour for this panel's block. */
  color: string
  /** Ink to set over that block. */
  onColor: string
  /** The panel's own head — one line, over the block. */
  headline: string
  /** Optional second line under the headline, in the casual face. */
  standfirst?: string
  render: () => React.ReactNode
}

const SWAP = { type: 'spring' as const, stiffness: 520, damping: 42, mass: 0.7 }

export function DeckShell({
  routeLabel,
  hoist,
  masthead,
  signals,
  activeId,
  onSelect,
  art,
}: {
  /** The route, spelled out for anyone not reading flags. */
  routeLabel: string
  /** Flag classes spelling the route. Decorative; aria-hidden. */
  hoist: string[]
  /** The fixed left column: title, claim, the one thing to do. */
  masthead: React.ReactNode
  signals: DeckSignal[]
  activeId: string
  onSelect: (id: string) => void
  /** Theme-paired hero art. Both are rendered; CSS picks. */
  art?: { light: string; dark: string; alt: string }
}) {
  const reduced = useReducedMotion()
  const active = signals.find((signal) => signal.id === activeId) ?? signals[0]
  const railRef = React.useRef<HTMLDivElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)

  // 100dvh is the viewport, and the deck does not start at the top of it: the
  // site header sits above. Hard-coding its height is wrong twice over — it
  // differs per breakpoint and it WRAPS to two rows on a narrow window, which
  // is exactly how this shipped 68px too tall at 1280 and 90px too tall at
  // 1440 on the first measurement. Measure where the deck actually begins and
  // take the rest of the screen; re-measure when the window changes, since a
  // resize is what makes the header wrap in the first place.
  React.useLayoutEffect(() => {
    const node = rootRef.current
    if (!node) return
    const fit = () => {
      const top = node.getBoundingClientRect().top + window.scrollY
      node.style.setProperty('--deck-h', `${Math.max(320, window.innerHeight - top)}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    if (observer && node.parentElement) observer.observe(node.parentElement)
    return () => {
      window.removeEventListener('resize', fit)
      observer?.disconnect()
    }
  }, [])

  // Left/right arrows move between panels the way a segmented control
  // should; without this the rail is a row of buttons you have to Tab
  // through one at a time to see what is behind each.
  const onRailKey = React.useCallback(
    (event: React.KeyboardEvent) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (!delta) return
      event.preventDefault()
      const index = signals.findIndex((signal) => signal.id === activeId)
      const next = signals[(index + delta + signals.length) % signals.length]
      onSelect(next.id)
      const button = railRef.current?.querySelector<HTMLButtonElement>(`[data-signal="${next.id}"]`)
      button?.focus()
    },
    [activeId, onSelect, signals],
  )

  return (
    <div
      ref={rootRef}
      // The fallback is the full viewport, which is right when the deck is the
      // only thing on the page and only ever too tall, never too short.
      style={{ height: 'var(--deck-h, 100dvh)' }}
      className="flex flex-col overflow-hidden bg-[var(--surface-base)]"
    >
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* The masthead never moves. It is the one thing on the page that is
            true regardless of which panel is open. */}
        <div className="flex min-h-0 flex-col justify-between gap-6 overflow-y-auto border-b-2 border-[var(--border-strong)] px-6 py-6 lg:border-b-0 lg:border-r-2 lg:px-8 lg:py-8">
          <div className="slug-hoist" aria-hidden="true">
            <span className="route">{routeLabel}</span>
            {hoist.map((flag, index) => (
              <i key={`${flag}-${index}`} className={`fl ${flag}`} />
            ))}
          </div>
          {masthead}
          {art ? (
            /* The plate is theme-paired rather than one image dimmed: the
               cut-paper set is lit differently for cream and for near-black,
               and a light plate on a dark ground reads as a hole in the page.
               Both ship; CSS chooses, so there is no flash on load and no
               JS in the path. */
            <figure className="deck-art mt-auto border-2 border-[var(--border-strong)]">
              <img
                className="plate-light block h-auto w-full"
                src={art.light}
                alt={art.alt}
                loading="lazy"
                decoding="async"
              />
              <img
                className="plate-dark block h-auto w-full"
                src={art.dark}
                alt={art.alt}
                loading="lazy"
                decoding="async"
              />
            </figure>
          ) : null}
        </div>

        {/* The deck proper. */}
        <div className="flex min-h-0 flex-col">
          <div
            ref={railRef}
            role="tablist"
            aria-label="Sections"
            onKeyDown={onRailKey}
            className="flex shrink-0 overflow-x-auto border-b-2 border-[var(--border-strong)]"
          >
            {signals.map((signal) => {
              const selected = signal.id === active.id
              return (
                <button
                  key={signal.id}
                  type="button"
                  role="tab"
                  data-signal={signal.id}
                  aria-selected={selected}
                  aria-controls={`panel-${signal.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onSelect(signal.id)}
                  title={`${signal.label} — signal ${signal.meaning}`}
                  className="relative flex shrink-0 items-center gap-2.5 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--brand-primary)]"
                >
                  <i className={`fl ${signal.flag}`} style={{ ['--fl-w' as string]: '22px', ['--fl-h' as string]: '16px' }} aria-hidden="true" />
                  <span
                    className="font-mono text-[12px] font-bold uppercase tracking-[0.11em]"
                    style={{ color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}
                  >
                    {signal.label}
                  </span>
                  {selected ? (
                    <motion.span
                      layoutId="deck-rail-stripe"
                      transition={reduced ? { duration: 0 } : SWAP}
                      className="absolute inset-x-0 bottom-0 h-[3px]"
                      style={{ background: signal.color }}
                    />
                  ) : null}
                </button>
              )
            })}
          </div>

          {/* The colour block. The head sits ON it, and the standfirst
              switches to the casual face over the block — the face change
              is the signal that you have crossed from chrome into voice. */}
          <div className="on-block shrink-0 px-6 py-5 lg:px-9 lg:py-6" style={{ background: active.color, color: active.onColor }}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 1 } : { opacity: 0, y: -4 }}
                transition={reduced ? { duration: 0 } : SWAP}
              >
                <h2 className="max-w-[24ch] text-[clamp(22px,2.4vw,34px)] font-bold leading-[1.08] tracking-[-0.02em]">
                  {active.headline}
                </h2>
                {active.standfirst ? (
                  <p className="deck-voice mt-2 max-w-[62ch] text-[15px] leading-[1.5] opacity-90">
                    {active.standfirst}
                  </p>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Only this scrolls. The page never does. */}
          <div
            id={`panel-${active.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${active.id}`}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-9 lg:py-7"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active.id}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 1 } : { opacity: 0 }}
                transition={reduced ? { duration: 0 } : SWAP}
              >
                {active.render()}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  )
}
