import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Download, Terminal } from 'lucide-react'
import { LiveGloryVideo } from './LiveGloryVideo'

export function Hero() {
  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid items-center gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(24rem,0.86fr)_minmax(34rem,1.14fr)] min-[1100px]:gap-[var(--space-7)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-5)]"
          >
            <SectionIntro
              eyebrow="For AI engineering teams"
              title={
                <>
                  A harbor-master for your{' '}
                  <span className="text-[var(--brand-primary)]">
                    coding agents.
                  </span>
                </>
              }
              description="Run ten agents on one repo without losing track. Port Daddy gives Claude Code, Codex, Cursor, Gemini CLI, Aider, and local models a shared-state substrate — sessions, claims, notes, channels, readiness, budgets, and salvage records that outlive the terminal that created them."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[15ch]"
              bodyClassName="max-w-[34rem]"
            />

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

            {/* Feature pills */}
            <div className="flex max-w-[34rem] flex-wrap gap-2">
              {[
                'Shared state substrate',
                'Visible ownership',
                'Fail-closed launches',
              ].map((label) => (
                <span
                  key={label}
                  className="rounded-[var(--radius-sm)] px-3 py-1 text-[length:var(--type-meta-size)] font-semibold"
                  style={{
                    background: 'color-mix(in srgb, var(--brand-secondary) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--brand-secondary) 20%, transparent)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {label}
                </span>
              ))}
            </div>

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

          {/* Right -- synchronized light/dark capture */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative min-[1100px]:-mr-[clamp(1rem,3vw,4rem)]"
          >
            <picture aria-hidden="true" className="pointer-events-none absolute -right-[6%] -top-[18%] hidden h-[56%] w-[76%] overflow-hidden border opacity-35 min-[1100px]:block dark:opacity-25" style={{ borderColor: 'var(--border-subtle)' }}>
              <source srcSet="/img/generated/agent-runtime-map.webp" type="image/webp" />
              <img
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                className="h-full w-full object-cover"
                src="/img/generated/agent-runtime-map.jpg"
              />
            </picture>
            <div className="relative z-10">
              <LiveGloryVideo />
            </div>
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
