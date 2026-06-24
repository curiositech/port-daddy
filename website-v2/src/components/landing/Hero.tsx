import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Check, Download, Terminal } from 'lucide-react'
import { LiveGloryVideo } from './LiveGloryVideo'
import { useTheme } from '@/lib/theme-context'
import { setHeroLogoVisible } from './heroLogoVisibility'

export function Hero() {
  const { theme } = useTheme()
  const logoRef = useRef<HTMLImageElement | null>(null)
  // Theme-aware animated radar mark: light artwork on light surfaces, dark on
  // dark. Sits at the top of the right column, above the FleetBar preview.
  const animatedLogo =
    theme === 'dark'
      ? '/logos/portdaddy-animated-darkmode.svg'
      : '/logos/portdaddy-animated-lightmode.svg'

  // While the big hero mark is on screen, the small nav mark is redundant —
  // hide it. An IntersectionObserver broadcasts the hero logo's visibility to
  // the SiteHeader via a tiny shared store. Always restore visibility on unmount
  // (e.g. when navigating away from the home page).
  useEffect(() => {
    const el = logoRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setHeroLogoVisible(entry.isIntersecting && entry.intersectionRatio > 0.35),
      { threshold: [0, 0.35, 1] },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      setHeroLogoVisible(false)
    }
  }, [])

  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid items-start gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(24rem,0.86fr)_minmax(34rem,1.14fr)] min-[1100px]:gap-[var(--space-7)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-6)]"
          >
            <SectionIntro
              eyebrow="Fleet coordination for coding agents"
              title={
                <>
                  Run a fleet of coding agents{' '}
                  <span className="text-[var(--brand-primary)]">
                    without losing track.
                  </span>
                </>
              }
              description="Point Claude Code, Codex, and Cursor at the same project and they step on each other — two agents edit one file, a crash takes its work with it, and you find out too late. Port Daddy keeps the record: every agent can see who is working where, read what the others learned, and pick up tasks that died mid-run. Nothing happens silently."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[18ch]"
              bodyClassName="max-w-[44rem]"
            />

            {/* Co-primary actions: install in one line, or take the Mac app.
                The load-bearing BYO-subscription line sits beneath as a quiet
                link (the full pitch is the next section). */}
            <div className="space-y-[var(--space-3)]">
              <div className="max-w-[26rem]">
                <CodeBlock language="bash" showHeaderLabel={false}>
                  {`brew install curiositech/tap/port-daddy`}
                </CodeBlock>
              </div>
              <div className="flex flex-wrap items-center gap-[var(--space-3)]">
                <Button asChild variant="primary" size="lg">
                  <Link to="/mac-preview#download">
                    <Download size={16} />
                    Get the Mac app
                    <ArrowRight size={16} />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <Link to="/docs/">
                    <Terminal size={16} />
                    Read the docs
                  </Link>
                </Button>
              </div>
              <Link
                to="/cli-backend"
                className="group inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] no-underline transition-colors hover:text-[var(--brand-primary)]"
              >
                Already pay for Claude Max or ChatGPT Pro? The fleet runs on it.
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </div>

            {/* Trust strip — the engineer's risk-reducers (the weakest vertex on
                the appeal triangle): local-first, no account, inspectable, broad
                tool support. Every line is a verifiable fact, not a guarantee. */}
            <div className="space-y-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-4)]">
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

          {/* Right -- the big animated mark sits at the top-right, above the
              FleetBar capture. */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative min-[1100px]:-mr-[clamp(1rem,3vw,4rem)]"
          >
            {/* Animated brand mark, top-right of the hero, above the preview.
                On wide screens its TOP is nudged down to line up with the top of
                the headline (past the eyebrow + intro gap in the left column). */}
            <motion.img
              ref={logoRef}
              src={animatedLogo}
              alt=""
              aria-hidden="true"
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, ease: 'easeOut' as const }}
              className="pointer-events-none mb-[var(--space-4)] ml-auto block h-32 w-32 select-none rounded-[var(--radius-md)] sm:h-40 sm:w-40 lg:h-48 lg:w-48 xl:h-56 xl:w-56 min-[1100px]:mt-[calc(var(--section-intro-gap)+1.875rem)]"
            />
            <div className="relative z-10">
              <LiveGloryVideo />
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
