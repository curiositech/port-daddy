import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Surface } from '@/components/ui/Surface'
import { IntentModal } from '@/components/ui/IntentModal'
import { ArrowRight, Terminal } from 'lucide-react'

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative flex items-center overflow-hidden pt-24 pb-8 lg:pt-32 lg:pb-12">
      {/* Subtle dot grid on the neumorphic surface */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, var(--text-muted) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr,1.1fr] gap-8 lg:gap-16 items-center">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
          >
            <Link to="/mcp" className="no-underline">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 cursor-pointer"
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

            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] leading-[1.15] mb-4 text-[var(--text-primary)]">
              Stop your agents from
              {' '}
              <span className="bg-gradient-to-r from-[var(--brand-primary)] to-[var(--status-error)] bg-clip-text text-transparent">
                fighting each other.
              </span>
            </h1>

            <p className="text-sm lg:text-base text-[var(--text-secondary)] leading-relaxed mb-5 max-w-md">
              Port Daddy coordinates AI agents — atomic ports, pub/sub messaging, file claims, and automatic work recovery. One install. Zero config. Works with Claude, OpenAI, Gemini, Ollama, or any LLM.
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mb-6 max-w-md">
              {[
                'Background fleet agents',
                'Auto-respawn on crash',
                'Works with any LLM',
              ].map((label) => (
                <span
                  key={label}
                  className="text-xs font-semibold px-3 py-1 rounded-full"
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

            <div className="flex flex-wrap items-center gap-3">
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
            <Surface depth="raised" radius="2xl" padding="none" className="overflow-hidden">
              <img
                src="/img/hero-portdaddy.png"
                alt="Port Daddy — the harbormaster for your AI agents"
                className="w-full h-auto block"
              />
            </Surface>
          </motion.div>
        </div>
      </div>

      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
