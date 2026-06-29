import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { FeaturedCardMedia } from './FeaturedMarquee'
import { featuredStoryCards, type FeaturedCard } from './FeaturedStories'
import { cn } from '@/lib/utils'

const initialHeroCardIndex = Math.max(
  0,
  featuredStoryCards.findIndex((card) => card.href === '/blog/your-ai-subscription-powers-the-fleet'),
)

function HeroStoryButton({
  card,
  active,
  onClick,
}: {
  card: FeaturedCard
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid grid-cols-[3.15rem_minmax(0,1fr)] items-center gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-2)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--interactive-focus)]',
        active
          ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
          : 'hover:bg-[var(--surface-base)]',
      )}
    >
      <span className="block aspect-[4/3] overflow-hidden border border-[var(--border-strong)] bg-[var(--surface-sunken)]">
        <FeaturedCardMedia media={card.media} className={active ? 'opacity-90' : 'opacity-100'} />
      </span>
      <span className="grid min-w-0 gap-[var(--space-1)]">
        <span
          className={cn(
            'font-sans text-[0.66rem] font-black uppercase tracking-[var(--tracking-meta)]',
            active ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-muted)]',
          )}
        >
          {card.audience}
        </span>
        <span
          className={cn(
            'text-balance break-words font-sans text-[0.94rem] font-black leading-[1.18]',
            active ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]',
          )}
        >
          {card.title}
        </span>
      </span>
    </button>
  )
}

export function LiveGloryVideo() {
  const reduceMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(initialHeroCardIndex)
  const titleId = useId()
  const activeCard = featuredStoryCards[activeIndex]

  useEffect(() => {
    if (reduceMotion) return

    const interval = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % featuredStoryCards.length)
    }, 6800)

    return () => window.clearInterval(interval)
  }, [reduceMotion])

  return (
    <section
      aria-labelledby={titleId}
      className="grid gap-[var(--space-3)] min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
    >
      <div className="relative overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={activeCard.title}
            className="grid min-h-[27rem] sm:min-h-[31rem] min-[1100px]:min-h-[35rem]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.62, ease: 'easeOut' }}
          >
            <div className="relative min-h-[17rem] overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
              <motion.div
                className="absolute inset-0"
                initial={reduceMotion ? false : { scale: 1.02 }}
                animate={reduceMotion ? undefined : { scale: 1.09 }}
                transition={{ duration: 7.6, ease: 'easeOut' }}
              >
                <FeaturedCardMedia media={activeCard.media} eager />
              </motion.div>
            </div>
            <Link
              to={activeCard.href}
              className="group grid content-end gap-[var(--space-3)] p-[var(--space-4)] text-[var(--text-primary)] no-underline sm:p-[var(--space-5)]"
            >
              <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                {activeCard.audience}
              </span>
              <span
                id={titleId}
                className="font-display text-[clamp(1.9rem,3.2vw,3.55rem)] font-black leading-[var(--leading-display-tight)]"
              >
                {activeCard.title}
              </span>
              <span className="max-w-[31rem] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                {activeCard.hook}
              </span>
              <span className="inline-flex w-fit items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors group-hover:bg-[var(--brand-primary)]">
                Open
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2 min-[1100px]:grid-cols-1">
        {featuredStoryCards.map((card, index) => (
          <HeroStoryButton
            key={card.title}
            card={card}
            active={index === activeIndex}
            onClick={() => setActiveIndex(index)}
          />
        ))}
      </div>
    </section>
  )
}
