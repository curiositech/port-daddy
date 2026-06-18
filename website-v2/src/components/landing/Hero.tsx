import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { CodeBlock } from '@/components/ui/CodeBlock'
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
          </motion.div>

          {/* Right -- synchronized light/dark capture */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="relative min-[1100px]:-mr-[clamp(1rem,3vw,4rem)]"
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
