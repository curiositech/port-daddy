import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { useEffect, useRef } from 'react'
import { PageContainer, SectionIntro, Wordmark } from '@/components/site/primitives'
import { ArrowRight, Check, Download, KeyRound, Terminal } from 'lucide-react'
import { LiveGloryVideo } from './LiveGloryVideo'
import { useHeroWordmark } from '@/lib/hero-brand-context'

export function Hero() {
  const { setHeroWordmarkVisible } = useHeroWordmark()
  const heroMarkRef = useRef<HTMLDivElement>(null)
  // Report whether the hero wordmark is on-screen so the navbar can hide its
  // own (duplicative) wordmark. rootMargin offsets the sticky header height, so
  // the mark counts as "gone" the moment it slides under the navbar.
  useEffect(() => {
    const el = heroMarkRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setHeroWordmarkVisible(entry.isIntersecting),
      { rootMargin: '-80px 0px 0px 0px', threshold: 0 },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      setHeroWordmarkVisible(false)
    }
  }, [setHeroWordmarkVisible])
  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid grid-cols-1 items-start gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(24rem,0.86fr)_minmax(34rem,1.14fr)] min-[1100px]:gap-x-[var(--space-7)] min-[1100px]:gap-y-[var(--space-5)]">
          {/* Brand mark — full-width at the top on mobile; up in the whitespace
              above the video (top-right) on desktop. The radar spins; the colour
              advances one notch per 180° flip. */}
          <motion.div
            ref={heroMarkRef}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="min-w-0 min-[1100px]:col-start-2 min-[1100px]:row-start-1"
          >
            <Wordmark variant="spin" className="w-full" />
          </motion.div>

          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="min-w-0 space-y-[var(--space-6)] min-[1100px]:col-start-1 min-[1100px]:row-start-1 min-[1100px]:row-span-2"
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
              <Link
                to="/squid-codex"
                className="group grid max-w-[34rem] gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)] no-underline transition-colors hover:border-[var(--brand-primary)]"
              >
                <span className="flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                  <KeyRound size={15} />
                  Run Claude Code with Codex and your ChatGPT Pro subscription
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
                  Giant Squid serves a local Claude-shaped bridge, injects fresh auth, and routes
                  the work through Codex CLI under the Port Daddy harness.
                </span>
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

          {/* Right -- synchronized light/dark capture */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative min-w-0 min-[1100px]:col-start-2 min-[1100px]:row-start-2 min-[1100px]:-mr-[clamp(1rem,3vw,4rem)]"
          >
            <div className="relative z-10">
              <LiveGloryVideo />
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
