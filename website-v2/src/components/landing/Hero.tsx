import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { PageContainer } from '@/components/site/primitives'
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
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: 'easeOut' as const }}
          className="mb-[var(--space-7)] grid gap-[var(--space-4)]"
        >
          <div className="flex items-center gap-[var(--space-3)]">
            <span
              aria-hidden="true"
              className="h-8 border-l-2 border-[var(--border-strong)]"
            />
            <span className="font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              What is Port Daddy?
            </span>
          </div>
          <h1 className="max-w-[13ch] font-sans text-[length:var(--type-hero-size)] font-black leading-[var(--leading-display-tight)] tracking-normal text-[var(--text-primary)]">
            The local coordination layer for{' '}
            <span className="text-[var(--brand-primary)]">coding agents.</span>
          </h1>
        </motion.div>

        <div className="grid items-start gap-[var(--space-6)] min-[1100px]:grid-cols-[minmax(22rem,0.78fr)_minmax(34rem,1.22fr)] min-[1100px]:gap-[var(--space-7)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-5)]"
          >
            <p className="max-w-[34rem] text-[length:var(--type-panel-body-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
              Port Daddy is the layer under your coding agents: a shared place for notes, work ownership, warnings, actor messages, readiness, budgets, and recoverable handoffs. Schedulers decide what runs. Port Daddy makes what agents know, touch, spend, and hand off inspectable.
            </p>

            <Link to="/mac-preview" className="no-underline">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="inline-grid max-w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold cursor-pointer sm:max-w-[34rem]"
                style={{
                  background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  color: 'var(--brand-primary)',
                }}
              >
                <span>New</span>
                <span className="min-w-0" style={{ color: 'var(--text-secondary)' }}>Agent radio, handoffs, resources, and launch readiness are visible in the app</span>
                <ArrowRight size={12} />
              </motion.div>
            </Link>

            {/* Feature pills */}
            <div className="flex max-w-[34rem] flex-wrap gap-2">
              {[
                'Agent-to-agent radio',
                'Recoverable handoffs',
                'Operator-visible truth',
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

          {/* Right -- synchronized light/dark capture */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative"
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
