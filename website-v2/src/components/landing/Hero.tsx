import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Download, Terminal } from 'lucide-react'
import { AboveFoldTeasers } from './AboveFoldTeasers'

export function Hero() {
  return (
    <section className="relative flex items-start overflow-hidden pb-[var(--space-5)] pt-[var(--space-5)] lg:pb-[var(--space-6)] lg:pt-[var(--space-6)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid items-start gap-[var(--space-5)] min-[1180px]:grid-cols-[minmax(23rem,0.58fr)_minmax(0,1.42fr)] min-[1180px]:gap-[var(--space-6)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-4)] min-[1180px]:space-y-[var(--space-5)]"
          >
            <SectionIntro
              eyebrow="What is Port Daddy?"
              title={
                <>
                  A local control plane for{' '}
                  <span className="text-[var(--brand-primary)]">
                    AI coding agents.
                  </span>
                </>
              }
              description="Port Daddy gives Claude, Codex, Aider, and custom agent tools a shared operating layer: sessions, file claims, locks, notes, inboxes, budgets, backend readiness, and salvage. It does not replace the model or scheduler. It makes multi-agent software work inspectable, recoverable, and safe enough to scale on one repo."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[15ch] min-[1180px]:max-w-[13ch]"
              bodyClassName="max-w-[38rem]"
            />

            {/* Feature pills */}
            <div className="hidden max-w-[34rem] flex-wrap gap-2 min-[520px]:flex">
              {[
                'Shared repo state',
                'Commit-time guardrails',
                'Recoverable agent work',
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
                  Download Mac preview
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

          {/* Right -- high-scent reading and example paths */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative min-[1180px]:-mr-[clamp(1rem,3vw,4rem)]"
          >
            <AboveFoldTeasers />
          </motion.div>
        </div>
      </PageContainer>
    </section>
  )
}
