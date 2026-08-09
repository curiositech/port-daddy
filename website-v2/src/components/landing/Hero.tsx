import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { ReceiptText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageContainer, PanelEyebrow, SectionIntro, Wordmark } from '@/components/site/primitives'
import { ProductLogoLockup, type ProductLogoKey } from '@/components/site/ProductLogos'
import { MarqueeTrack } from './FeaturedMarquee'
import { useHeroWordmark } from '@/lib/hero-brand-context'

const productSurfaces = [
  'a harness',
  'white papers',
  'an agent event-triggering lab',
  'agent skills',
  'an MCP server',
  'a Rust app',
  'a CLI',
  'an orchestrator',
  'an SDK',
]

const supportedTools: ProductLogoKey[] = ['codex', 'claude', 'ollama', 'cursor', 'windsurf']

export function Hero() {
  const { setHeroWordmarkVisible } = useHeroWordmark()
  // Two placements of the same animated wordmark: a float beside the title on
  // mobile, and a centered mark over the preview on desktop. Only one is
  // displayed at a time, so whichever is active drives the navbar signal.
  const mobileHeroMarkRef = useRef<HTMLSpanElement>(null)
  const desktopHeroMarkRef = useRef<HTMLDivElement>(null)

  // Report whether either responsive hero wordmark is on-screen so the navbar
  // can hide its own duplicative wordmark. rootMargin offsets the sticky header
  // height, so the mark counts as "gone" once it slides under the navbar.
  useEffect(() => {
    const els = [mobileHeroMarkRef.current, desktopHeroMarkRef.current].filter(
      (el): el is HTMLSpanElement | HTMLDivElement => el != null,
    )
    if (els.length === 0) return
    const visibleByElement = new WeakMap<Element, boolean>()
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibleByElement.set(entry.target, entry.isIntersecting)
        })
        setHeroWordmarkVisible(els.some((el) => visibleByElement.get(el) ?? false))
      },
      { rootMargin: '-80px 0px 0px 0px', threshold: 0 },
    )
    els.forEach((el) => observer.observe(el))
    return () => {
      observer.disconnect()
      setHeroWordmarkVisible(false)
    }
  }, [setHeroWordmarkVisible])
  return (
    <section className="relative flex min-h-[calc(100svh-4.5rem)] items-center overflow-hidden py-[var(--space-3)] sm:py-[clamp(var(--space-4),4vw,var(--space-7))]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer width="wide" className="relative z-10">
        <div className="grid grid-cols-1 items-center gap-[var(--space-5)] min-[1100px]:grid-cols-[minmax(28rem,0.78fr)_minmax(44rem,1.22fr)] min-[1100px]:gap-x-[clamp(var(--space-5),4vw,var(--space-8))]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="min-w-0 space-y-[var(--space-3)] sm:space-y-[var(--space-4)] min-[1100px]:col-start-1 min-[1100px]:row-start-1"
          >
            <SectionIntro
              eyebrow="Fleet coordination for coding agents"
              title={
                <>
                  {/* Mobile only: the mark floats to the right of the headline so
                      the title text wraps around it. Hidden at >=1100px, where the
                      centered mark in the right column takes over. */}
                  <motion.span
                    ref={mobileHeroMarkRef}
                    aria-hidden="true"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.7, ease: 'easeOut' as const }}
                    className="float-right mb-[var(--space-2)] ml-[var(--space-3)] block h-32 w-32 overflow-hidden sm:h-40 sm:w-40 min-[1100px]:hidden"
                  >
                    <Wordmark variant="spin" className="h-full max-w-none" />
                  </motion.span>
                  Run a tight ship.{' '}
                  <span className="text-[var(--brand-primary)]">
                    Agents sail safer when they coordinate.
                  </span>
                </>
              }
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[14ch] text-[3rem] leading-[0.96] sm:text-[length:var(--type-hero-size)]"
            />

            <div className="grid max-w-[46rem] gap-[var(--space-2)] sm:gap-[var(--space-3)]">
              {/* Stripe card (ch. 20): card well + hairline edge + 3px cobalt
                  state stripe — secondary surfaces shed enclosure chrome. */}
              <div className="lw-stripe-card p-[var(--space-3)] pl-[var(--space-4)] sm:p-[var(--space-4)] sm:pl-[var(--space-5)]">
                <p className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  Port Daddy is
                </p>
                <p className="mt-[var(--space-2)] max-w-[38rem] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)] sm:text-[length:var(--type-panel-body-size)] sm:leading-[var(--leading-body)]">
                  {productSurfaces.join(', ')}.
                </p>
              </div>

              {/* Left-anchored midline: "continues from above" (ch. 20 midline
                  dialect) — texture-weight, replaces the heavy 2px rule. */}
              <div className="lw-midline flex flex-wrap items-center gap-x-[var(--space-2)] gap-y-2 pt-[var(--space-2)] text-[length:var(--type-meta-size)] text-[var(--text-muted)] sm:pt-[var(--space-3)]">
                <span className="font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                  Runs on
                </span>
                {supportedTools.map((tool) => (
                  <ProductLogoLockup
                    key={tool}
                    product={tool}
                    size="compact"
                    className="min-h-7 w-7 justify-center border-0 bg-transparent px-0 py-0 text-[0.68rem] sm:w-auto sm:justify-start"
                    labelClassName="hidden sm:inline"
                  />
                ))}
                <span className="font-semibold uppercase tracking-[var(--tracking-meta)]">
                  + more
                </span>
              </div>

              {/* Account CTA — secondary on purpose: install stays the primary
                  path; signed-in operators get straight to their run receipts. */}
              <div className="flex flex-wrap gap-[var(--space-3)]">
                <Button asChild variant="secondary" size="lg">
                  <a href="https://relay.portdaddy.dev/account/runs">
                    <ReceiptText size={16} aria-hidden="true" />
                    See your fleet&apos;s receipts
                  </a>
                </Button>
              </div>

            </div>
          </motion.div>

          {/* Right -- the big animated wordmark sits above the live story marquee. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative hidden min-w-0 min-[1100px]:col-start-2 min-[1100px]:row-start-1 min-[1100px]:block min-[1400px]:-mr-[var(--space-5)]"
          >
            {/* Animated wordmark, centered over the FleetBar preview below it.
                On wide screens its top is nudged down to line up with the top of
                the headline (past the eyebrow + intro gap in the left column). */}
            <motion.div
              ref={desktopHeroMarkRef}
              aria-hidden="true"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: 'easeOut' as const }}
              className="pointer-events-none mx-auto mb-[var(--space-4)] hidden w-[min(55rem,58vw)] select-none min-[1100px]:block"
            >
              <Wordmark variant="spin" className="w-full" />
            </motion.div>
            <div className="relative z-10 space-y-[var(--space-3)] overflow-hidden">
              <PanelEyebrow>From the harbor - what people open first</PanelEyebrow>
              <MarqueeTrack flush />
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
