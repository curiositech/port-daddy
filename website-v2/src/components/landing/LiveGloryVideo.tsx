import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

type SpotlightCard = {
  href: string
  eyebrow: string
  statement: string
  proof: string
  media: {
    src: string
    alt: string
    position?: string
  }
}

const spotlightCards: SpotlightCard[] = [
  {
    href: '/blog/the-pr-that-reviews-itself',
    eyebrow: 'Agentic review',
    statement: 'How we use Port Daddy to auto-review every diff with a cast of agents.',
    proof: 'Six specialized reviewers can land on the same PR before the author leaves GitHub.',
    media: {
      src: '/img/generated/pr-reviews-itself/hero.webp',
      alt: 'A kitchen brigade of specialist reviewers already working on a pull request.',
    },
  },
  {
    href: '/blog/your-ai-subscription-powers-the-fleet',
    eyebrow: 'Subscription leverage',
    statement: 'Powering a fleet with the Pro and Max subscriptions teams already pay for.',
    proof: 'One operator keeps the cursor. The extra streams run in bounded worktrees.',
    media: {
      src: '/img/generated/blog-ai-subscription-fleet-hero.jpg',
      alt: 'A single AI subscription badge fanning into many ship-shaped agents.',
    },
  },
  {
    href: '/blog/attention-is-the-first-command',
    eyebrow: 'Operational memory',
    statement: 'The agent that wakes up first reads the room before touching your code.',
    proof: 'Notes, channels, inboxes, and salvage state become the first prompt, not an afterthought.',
    media: {
      src: '/img/generated/attention-first-command/hero.webp',
      alt: 'A harbor mailroom where unread agent messages are sorted into named slots.',
    },
  },
  {
    href: '/control-plane',
    eyebrow: 'Control plane',
    statement: 'The product is not more agents. It is the surface where they stay accountable.',
    proof: 'Identity, ownership, backend, budget, and recovery agree before a launch starts.',
    media: {
      src: '/img/generated/control-plane-hero.webp',
      alt: 'A control-plane dashboard arranging agent state, readiness gates, and project lanes.',
      position: 'center top',
    },
  },
]

export function LiveGloryVideo() {
  const { theme } = useTheme()
  const reduceMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
  const titleId = useId()
  const activeCard = spotlightCards[activeIndex]
  const dark = theme === 'dark'

  useEffect(() => {
    if (reduceMotion) return

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % spotlightCards.length)
    }, 6200)

    return () => window.clearInterval(interval)
  }, [reduceMotion])

  return (
    <figure
      className="grid gap-[var(--space-3)]"
      aria-labelledby={titleId}
    >
      <div
        className="relative overflow-hidden border-2"
        style={{
          background: 'var(--surface-raised)',
          borderColor: 'var(--border-strong)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="relative aspect-[16/11] min-h-[17.5rem] w-full overflow-hidden bg-[var(--surface-sunken)] sm:min-h-[23rem] lg:min-h-[26rem]">
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={activeCard.statement}
              className="absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.8, ease: 'easeOut' }}
            >
              <motion.img
                src={activeCard.media.src}
                alt={activeCard.media.alt}
                className="h-full w-full object-cover"
                style={{
                  objectPosition: activeCard.media.position ?? 'center',
                  filter: dark ? 'brightness(0.72) contrast(1.18) saturate(1.1)' : 'saturate(1.02)',
                }}
                initial={reduceMotion ? false : { scale: 1.02 }}
                animate={reduceMotion ? undefined : { scale: 1.1 }}
                transition={{ duration: 7.4, ease: 'easeOut' }}
                loading="eager"
                decoding="async"
              />
            </motion.div>
          </AnimatePresence>

          <div
            className="absolute inset-0"
            style={{
              background: dark
                ? 'linear-gradient(90deg, rgba(11,13,16,0.92) 0%, rgba(11,13,16,0.62) 44%, rgba(11,13,16,0.18) 100%)'
                : 'linear-gradient(90deg, rgba(245,241,233,0.94) 0%, rgba(245,241,233,0.68) 42%, rgba(245,241,233,0.12) 100%)',
            }}
          />

          <div className="absolute inset-x-0 top-0 flex items-center justify-between border-b-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)]">
            <span className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              Harbor signal
            </span>
            <div className="flex items-center gap-[var(--space-1)]">
              {spotlightCards.map((card, index) => (
                <button
                  key={card.statement}
                  type="button"
                  aria-label={`Show card ${index + 1}: ${card.eyebrow}`}
                  aria-pressed={activeIndex === index}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    'h-3 w-3 border border-[var(--border-strong)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--interactive-focus)]',
                    activeIndex === index ? 'bg-[var(--brand-primary)]' : 'bg-[var(--surface-base)]',
                  )}
                />
              ))}
            </div>
          </div>

          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={activeCard.statement}
              className="absolute bottom-0 left-0 max-w-[min(31rem,calc(100%-var(--space-4)))] p-[var(--space-4)] sm:p-[var(--space-5)]"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
              transition={{ duration: reduceMotion ? 0 : 0.55, ease: 'easeOut' }}
            >
              <Link to={activeCard.href} className="group grid gap-[var(--space-3)] no-underline">
                <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  {activeCard.eyebrow}
                </span>
                <span
                  id={titleId}
                  className="font-display text-[clamp(1.55rem,3vw,2.8rem)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]"
                >
                  {activeCard.statement}
                </span>
                <span className="hidden max-w-[30rem] font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)] sm:block">
                  {activeCard.proof}
                </span>
                <span className="hidden w-fit items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors group-hover:bg-[var(--brand-primary)] sm:inline-flex">
                  Open the story
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </Link>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <figcaption className="font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
        Slow rotating story cards replace the old live-glory video loop; motion stops when reduced motion is requested.
      </figcaption>
    </figure>
  )
}
