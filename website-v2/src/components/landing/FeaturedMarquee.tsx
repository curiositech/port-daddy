import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { PageContainer, PanelEyebrow } from '@/components/site/primitives'
import { ThemedImage } from '@/components/site/ThemedImage'
import { cn } from '@/lib/utils'
import { featuredStoryCards, type FeaturedCard } from './FeaturedStories'

export function FeaturedCardMedia({
  media,
  className,
  eager = false,
}: {
  media: FeaturedCard['media']
  className?: string
  eager?: boolean
}) {
  if (media.kind === 'video') {
    return (
      <video
        className={cn('h-full w-full object-cover', className)}
        src={media.src}
        poster={media.poster}
        autoPlay
        loop
        muted
        playsInline
        aria-hidden="true"
      />
    )
  }

  return (
    <ThemedImage
      className={cn('h-full w-full object-cover', className)}
      src={media.src}
      alt={media.alt}
      style={{ objectPosition: media.position ?? 'center' }}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  )
}

export function FeaturedMarquee() {
  const reduceMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
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
      aria-labelledby="featured-marquee-title"
      className="overflow-hidden border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[clamp(var(--space-5),6vw,var(--space-8))]"
      id="featured-marquee"
    >
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.58fr)_minmax(24rem,0.42fr)] lg:items-end">
          <div className="grid gap-[var(--space-2)]">
            <PanelEyebrow>Signals worth opening first</PanelEyebrow>
            <h2
              id="featured-marquee-title"
              className="max-w-[18ch] font-display text-[clamp(1.8rem,3vw,3.1rem)] font-black leading-[var(--leading-display-tight)] text-[var(--text-primary)]"
            >
              Stories that make agent fleets feel real.
            </h2>
          </div>
          <p className="max-w-[35rem] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
            No ticker. No repeated card parade. A few concrete scenes for the people who need to
            understand what Port Daddy changes: builders, operators, journalists, security teams,
            and investors.
          </p>
        </div>

        <div className="mt-[var(--space-5)] grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_minmax(17rem,23rem)]">
          <div className="relative overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
            <AnimatePresence initial={false} mode="wait">
              <motion.div
                key={activeCard.title}
                className="grid min-h-[31rem] lg:grid-cols-[minmax(0,1.04fr)_minmax(19rem,0.96fr)]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.65, ease: 'easeOut' }}
              >
                <div className="relative min-h-[17rem] overflow-hidden border-b-2 border-[var(--border-strong)] bg-[var(--surface-sunken)] lg:border-b-0 lg:border-r-2">
                  <motion.div
                    className="absolute inset-0"
                    initial={reduceMotion ? false : { scale: 1.02 }}
                    animate={reduceMotion ? undefined : { scale: 1.09 }}
                    transition={{ duration: 7.6, ease: 'easeOut' }}
                  >
                    <FeaturedCardMedia media={activeCard.media} />
                  </motion.div>
                </div>
                <Link
                  to={activeCard.href}
                  className="group grid content-end gap-[var(--space-3)] p-[var(--space-4)] text-[var(--text-primary)] no-underline sm:p-[var(--space-5)]"
                >
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    {activeCard.audience}
                  </span>
                  <span className="font-display text-[clamp(1.8rem,3vw,3.4rem)] font-black leading-[var(--leading-display-tight)]">
                    {activeCard.title}
                  </span>
                  <span className="max-w-[30rem] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
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

          <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-2 lg:grid-cols-1">
            {featuredStoryCards.map((card, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={card.title}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setActiveIndex(index)}
                  className={cn(
                    'grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-[var(--space-3)] bg-[var(--surface-raised)] p-[var(--space-2)] text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--interactive-focus)]',
                    active ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]' : 'hover:bg-[var(--surface-base)]',
                  )}
                >
                  <span className="block aspect-[4/3] overflow-hidden border border-[var(--border-strong)] bg-[var(--surface-sunken)]">
                    <FeaturedCardMedia
                      media={card.media}
                      className={active ? 'opacity-90' : 'opacity-100'}
                    />
                  </span>
                  <span className="grid min-w-0 gap-[var(--space-1)]">
                    <span
                      className={cn(
                        'font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
                        active ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-muted)]',
                      )}
                    >
                      {card.audience}
                    </span>
                    <span
                      className={cn(
                        'text-balance font-sans text-[length:var(--type-panel-body-compact-size)] font-black leading-[var(--leading-body-compact)]',
                        active ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]',
                      )}
                    >
                      {card.title}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </PageContainer>
    </section>
  )
}
