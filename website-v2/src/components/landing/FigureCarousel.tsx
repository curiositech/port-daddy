import * as React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export interface FigureSlide {
  key: string
  /** Short title — used for the slide's accessible label. */
  title: string
  /** One-line plain-language description — accessible label only; the figure
   *  carries its own visible caption, so we don't render this twice. */
  explainer: string
  /** The bespoke, theme-aware, self-captioned SVG figure. */
  figure: React.ReactNode
}

const AUTO_MS = 5200

/**
 * Auto-animating gallery of the bespoke paper figures. Each slide is ONE
 * self-contained figure (its own single border + caption = one clean
 * figure-ground unit) — the carousel adds no competing border or duplicate
 * text, only minimal controls below. Crossfades on a timer, pauses on
 * hover/focus, honours prefers-reduced-motion.
 */
export function FigureCarousel({ slides }: { slides: FigureSlide[] }) {
  const reduce = useReducedMotion()
  const [index, setIndex] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const count = slides.length

  const go = React.useCallback(
    (next: number) => setIndex(((next % count) + count) % count),
    [count],
  )

  React.useEffect(() => {
    if (reduce || paused || count <= 1) return
    const timer = setInterval(() => setIndex((p) => (p + 1) % count), AUTO_MS)
    return () => clearInterval(timer)
  }, [reduce, paused, count])

  const slide = slides[index]

  const arrowClass =
    'inline-flex border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-1)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]'

  return (
    <div
      role="group"
      aria-roledescription="carousel"
      aria-label="Figures from the Port Daddy papers"
      className="select-none"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          go(index - 1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          go(index + 1)
        }
      }}
    >
      {/* Stage — one self-contained figure per slide. Fixed-ish height so the
          band doesn't jump as slides crossfade. */}
      <div className="relative flex min-h-[25rem] items-center justify-center sm:min-h-[27rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={slide.key}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.4, ease: 'easeOut' as const }}
            className="w-full"
          >
            <div className="mx-auto w-full max-w-[66rem]">{slide.figure}</div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls — pager · ticks · arrows, one row, no border. */}
      <div className="mt-[var(--space-4)] flex items-center justify-between gap-[var(--space-3)]">
        <div className="flex items-center gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            {String(index + 1).padStart(2, '0')} / {String(count).padStart(2, '0')}
          </span>
          <div className="flex flex-wrap gap-[var(--space-2)]">
            {slides.map((s, idx) => (
              <button
                key={s.key}
                type="button"
                onClick={() => go(idx)}
                aria-label={`Show figure ${idx + 1}: ${s.title}`}
                aria-current={idx === index}
                className={`h-2 w-6 border border-[var(--border-strong)] transition-colors ${
                  idx === index
                    ? 'bg-[var(--brand-primary)]'
                    : 'bg-transparent hover:bg-[var(--surface-strong)]'
                }`}
              />
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[var(--space-2)]">
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous figure" className={arrowClass}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next figure" className={arrowClass}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
