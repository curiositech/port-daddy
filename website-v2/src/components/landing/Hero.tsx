import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { PageContainer, SectionIntro, Wordmark } from '@/components/site/primitives'
import { ArrowRight, Check, Download, KeyRound, Terminal } from 'lucide-react'
import { LiveGloryVideo } from './LiveGloryVideo'
import { useHeroWordmark } from '@/lib/hero-brand-context'

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
    <section className="relative flex items-center overflow-hidden py-[clamp(var(--space-5),5vw,var(--space-8))]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid grid-cols-1 items-center gap-[var(--space-5)] min-[1100px]:grid-cols-[minmax(24rem,0.82fr)_minmax(38rem,1.18fr)] min-[1100px]:gap-x-[var(--space-6)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="min-w-0 space-y-[var(--space-4)] min-[1100px]:col-start-1 min-[1100px]:row-start-1"
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
                  Run agent fleets{' '}
                  <span className="text-[var(--brand-primary)]">
                    without losing track.
                  </span>
                </>
              }
              description="Run Claude Code, Codex, Cursor, and the rest in one repo without losing the thread. Port Daddy records who is working where, what changed, and how another agent can safely resume."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[18ch]"
              bodyClassName="max-w-[39rem]"
            />

            <div className="grid max-w-[46rem] gap-[var(--space-3)]">
              <div className="overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--border-strong)]">
                <div className="flex items-center justify-between gap-[var(--space-3)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)]">
                  <div className="flex items-center gap-[var(--space-1)]" aria-hidden="true">
                    <span className="h-2.5 w-2.5 bg-[var(--brand-accent)]" />
                    <span className="h-2.5 w-2.5 bg-[var(--brand-primary)]" />
                    <span className="h-2.5 w-2.5 bg-[var(--text-muted)]" />
                  </div>
                  <span className="font-mono text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    local install
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-px">
                  <div className="flex min-w-0 items-center gap-[var(--space-2)] bg-[var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-3)]">
                    <Terminal size={16} className="shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
                    <code className="truncate font-mono text-[length:var(--type-panel-body-compact-size)] text-[var(--text-primary)]">
                      brew install curiositech/tap/port-daddy
                    </code>
                  </div>
                  <Link
                    to="/mac-preview#download"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] no-underline transition-colors hover:bg-[var(--brand-primary)]"
                  >
                    <Download size={15} aria-hidden="true" />
                    <span>Mac app</span>
                  </Link>
                  <Link
                    to="/docs/"
                    className="inline-flex items-center justify-center gap-[var(--space-2)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-3)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] no-underline transition-colors hover:bg-[var(--surface-strong)]"
                  >
                    <span aria-hidden="true">&gt;_</span>
                    <span>Docs</span>
                  </Link>
                </div>
              </div>

              <div className="min-[1100px]:hidden">
                <LiveGloryVideo />
              </div>

              <div className="grid gap-px border-2 border-[var(--border-strong)] bg-[var(--border-strong)] sm:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
                <Link
                  to="/cli-backend"
                  className="group grid gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-3)] no-underline transition-colors hover:bg-[var(--surface-base)]"
                >
                  <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)]">
                    Use the subscription you already pay for
                  </span>
                  <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    Claude Max or ChatGPT Pro becomes local fleet capacity.
                    <ArrowRight size={14} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
                <Link
                  to="/squid-codex"
                  className="group grid gap-[var(--space-2)] bg-[var(--surface-raised)] p-[var(--space-3)] no-underline transition-colors hover:bg-[var(--surface-base)]"
                >
                  <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    <KeyRound size={15} />
                    Giant Squid bridge
                  </span>
                  <span className="font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                    Claude-shaped requests route through Codex CLI while Port Daddy keeps the run local and auditable.
                  </span>
                </Link>
              </div>
            </div>

            {/* Trust strip — the engineer's risk-reducers (the weakest vertex on
                the appeal triangle): local-first, no account, inspectable, broad
                tool support. Every line is a verifiable fact, not a guarantee. */}
            <div className="space-y-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
              <div className="flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-[var(--space-1)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                <span className="inline-flex items-center gap-[var(--space-2)] text-[var(--brand-primary)]">
                  <Check size={15} strokeWidth={2.5} aria-hidden="true" />
                  Runs on your machine
                </span>
                <span>No account, no cloud</span>
                <a
                  href="https://github.com/curiositech/port-daddy"
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex items-center gap-[var(--space-1)] text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--brand-primary)]"
                >
                  Read the source on GitHub
                  <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
                <span className="font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                  Works with
                </span>
                {['Claude Code', 'Codex', 'Cursor', 'Windsurf', 'Cline'].map((tool, i) => (
                  <span key={tool} className="inline-flex items-center gap-[var(--space-3)]">
                    {i > 0 && <span aria-hidden="true">·</span>}
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right -- the big animated wordmark sits above the FleetBar capture. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative hidden min-w-0 min-[1100px]:col-start-2 min-[1100px]:row-start-1 min-[1100px]:block min-[1100px]:-mr-[clamp(1rem,3vw,4rem)]"
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
              className="pointer-events-none mx-auto mb-[var(--space-3)] hidden w-[min(34rem,42vw)] select-none min-[1100px]:block"
            >
              <Wordmark variant="spin" className="w-full" />
            </motion.div>
            <div className="relative z-10">
              <LiveGloryVideo />
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
