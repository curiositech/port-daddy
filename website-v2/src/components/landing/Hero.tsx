import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Download, Terminal } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        {/* Full-width headline — the H1 spans the whole container, the
            two-column copy/video grid starts below it. */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' as const }}
          className="mb-[var(--space-6)]"
        >
          <SectionIntro
            eyebrow="For AI engineering teams"
            title={
              <>
                A local control plane for{' '}
                <span className="text-[var(--brand-primary)]">
                  coding agents.
                </span>
              </>
            }
            description="Port Daddy gives Claude Code, Codex, Cursor, Gemini CLI, Aider, and local model agents a shared-state substrate: sessions, claims, notes, channels, readiness, budgets, and salvage records that survive the terminal that created them."
            titleAs="h1"
            titleSize="hero"
            titleClassName="max-w-none"
            bodyClassName="max-w-[62ch]"
          />
        </motion.div>

        <div className="grid items-start gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(24rem,0.86fr)_minmax(34rem,1.14fr)] min-[1100px]:gap-[var(--space-7)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-5)]"
          >
            {/* CLI-backend pitch — the operator's load-bearing line. */}
            <Link
              to="/cli-backend"
              className="group block max-w-[34rem] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]"
            >
              <div className="flex items-start justify-between gap-[var(--space-3)]">
                <div className="space-y-[var(--space-2)]">
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] group-hover:text-[color:var(--brand-primary-foreground-muted)]">
                    Already pay for Claude Max or ChatGPT Pro?
                  </span>
                  <p className="font-sans text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-primary)] group-hover:text-[var(--brand-primary-foreground)]">
                    <strong>The fleet rides on your subscription at $0 marginal cost.</strong>{' '}
                    Claude Code and Codex as first-class backends — setup takes two minutes.
                  </p>
                </div>
                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="mt-1 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--brand-primary-foreground)]"
                />
              </div>
            </Link>

            <div className="flex flex-wrap items-center gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <Link to="/mac-preview#download">
                  <Download size={16} />
                  Evaluate Mac preview
                  <ArrowRight size={16} />
                </Link>
              </Button>
              <Button asChild variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <Link to="/docs/">
                  <Terminal size={16} />
                  Technical Docs
                </Link>
              </Button>
            </div>
          </motion.div>

          {/* Right -- the system, as the paper draws it */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
          >
            <figure className="m-0">
              <Link to="/whitepaper" className="block border-2 border-[var(--border-strong)] bg-[#FBF7EF] p-[var(--space-4)] no-underline">
                <img
                  src="/img/papers/swk-stack-map.png"
                  alt="Stack map from the Single-Writer Kernel paper: the machine and operating system at the base, the daemon substrate above it, then the coordination protocol for agents, legibility and authority for the operator, and economy and federation at the top."
                  className="h-auto w-full"
                  fetchPriority="high"
                  decoding="async"
                />
              </Link>
              <figcaption className="mt-[var(--space-2)] flex items-baseline justify-between font-mono text-[length:var(--type-meta-size)] uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
                <span>Fig. 1 — the stack, machine to market</span>
                <Link to="/whitepaper" className="text-[var(--brand-accent)]">
                  From the papers →
                </Link>
              </figcaption>
            </figure>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
