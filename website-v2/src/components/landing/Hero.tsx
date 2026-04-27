import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import { PageContainer, SectionIntro } from '@/components/site/primitives'
import { ArrowRight, Terminal } from 'lucide-react'

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative flex items-center overflow-hidden py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      {/* Swiss-grid field for the infrastructure diagram. */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <PageContainer className="relative z-10">
        <div className="grid items-center gap-[var(--space-6)] min-[900px]:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] min-[900px]:gap-[var(--space-8)]">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-[var(--space-5)]"
          >
            <Link to="/mcp" className="no-underline">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold mb-4 cursor-pointer"
                style={{
                  background: 'color-mix(in srgb, var(--brand-primary) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)',
                  color: 'var(--brand-primary)',
                }}
              >
                <span>New</span>
                <span style={{ color: 'var(--text-secondary)' }}>Fleet + auto-respawn — background agents that never die</span>
                <ArrowRight size={12} />
              </motion.div>
            </Link>

            <SectionIntro
              eyebrow="Multi-agent control plane"
              title={
                <>
                  Stop your agents from{' '}
                  <span className="bg-gradient-to-r from-[var(--brand-primary)] to-[var(--status-error)] bg-clip-text text-transparent">
                    fighting each other.
                  </span>
                </>
              }
              description="Port Daddy coordinates AI agents through atomic ports, pub/sub messaging, file claims, and automatic work recovery. One install. Zero config. Current built-in runtimes cover Claude, Claude CLI, Gemini, Ollama, Aider, and custom shell-backed agents."
              titleAs="h1"
              titleSize="hero"
              titleClassName="max-w-[12ch]"
              bodyClassName="max-w-[34rem]"
            />

            {/* Feature pills */}
            <div className="flex max-w-[34rem] flex-wrap gap-2">
              {[
                'Background fleet agents',
                'Auto-respawn on crash',
                'Budget-gated launches',
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
              <Button
                variant="primary"
                size="lg"
                onClick={() => setIsModalOpen(true)}
              >
                <Terminal size={16} />
                Get Started
                <ArrowRight size={16} />
              </Button>
              <Link to="/mcp">
                <Button variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  MCP Integration
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right -- Hero Illustration */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
          >
            <figure
              className="overflow-hidden rounded-[var(--radius-md)] border"
              style={{
                background: 'var(--surface-raised)',
                borderColor: 'var(--border-subtle)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <picture>
                <source srcSet="/img/generated/control-plane-hero.webp" type="image/webp" />
                <img
                  src="/img/generated/control-plane-hero.jpg"
                  alt="Port Daddy control-plane visualization showing agent sessions, locks, ports, and recovery flows"
                  className="block aspect-[16/9] h-auto w-full object-cover"
                />
              </picture>
            </figure>
          </motion.div>
        </div>
      </PageContainer>

      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
