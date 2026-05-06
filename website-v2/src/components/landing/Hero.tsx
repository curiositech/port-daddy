import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Download, RadioTower, Terminal } from 'lucide-react'
import { LiveGloryVideo } from './LiveGloryVideo'

export function Hero() {
  const coordinationStrip = (
    <div className="relative z-20 mb-[var(--space-6)] grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)] sm:grid-cols-[auto_minmax(0,1fr)]">
      <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--brand-primary)]">
        <RadioTower size={18} />
      </span>
      <div className="grid gap-1">
        <span className="font-mono text-[10px] font-black uppercase tracking-[0.18em] text-[var(--brand-primary)]">
          Evaluator signal
        </span>
        <p className="max-w-none text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          Port Daddy turns agent work into inspectable state: ownership, readiness, cost, resources, handoffs, and recovery.
        </p>
      </div>
    </div>
  )

  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        {coordinationStrip}
        <div className="grid items-center gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(24rem,0.86fr)_minmax(34rem,1.14fr)] min-[1100px]:gap-[var(--space-7)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-5)]"
          >
            <Link to="/mac-preview" className="no-underline">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold mb-4 cursor-pointer"
                style={{
                  background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  color: 'var(--brand-primary)',
                }}
              >
                <span>Preview</span>
                <span style={{ color: 'var(--text-secondary)' }}>A local control plane for engineers evaluating serious coding-agent workflows</span>
                <ArrowRight size={12} />
              </motion.div>
            </Link>

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
              titleClassName="max-w-[14ch]"
              bodyClassName="max-w-[34rem]"
            />

            {/* Feature pills */}
            <div className="flex max-w-[34rem] flex-wrap gap-2">
              {[
                'Shared state substrate',
                'Visible ownership',
                'Fail-closed launches',
              ].map((label) => (
                <span
                  key={label}
                  className="rounded-[var(--radius-sm)] px-3 py-1 text-xs font-semibold"
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
