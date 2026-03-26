import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import { ArrowRight, Terminal } from 'lucide-react'

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative flex items-center overflow-hidden pt-24 pb-8 lg:pt-32 lg:pb-12">
      {/* Subtle dot grid on the neumorphic surface */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, #888 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-[1fr,1.1fr] gap-12 lg:gap-16 items-center">
          {/* Left -- Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
          >
            <p className="text-xs font-mono text-[var(--brand-accent)] tracking-wide mb-3 uppercase">
              Multi-agent coordination
            </p>

            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-[-0.02em] leading-[1.15] mb-4 text-[var(--text-primary)]">
              Stop your agents from
              {' '}
              <span className="bg-gradient-to-r from-[#CC3D2E] to-[#A83226] bg-clip-text text-transparent">
                fighting each other.
              </span>
            </h1>

            <p className="text-sm lg:text-base text-[var(--text-secondary)] leading-relaxed mb-6 max-w-md">
              Port Daddy is a daemon that gives every AI agent its own port, coordinates file access, and recovers work when they crash. One install. Zero config.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setIsModalOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer transition-all duration-200"
                style={{
                  background: 'var(--brand-primary)',
                  boxShadow: 'var(--shadow-neu-sm)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-neu-flat)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-neu-sm)'
                }}
              >
                <Terminal size={16} />
                Get Started
                <ArrowRight size={16} />
              </button>
              <Link to="/docs">
                <Button variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  Read the Docs
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right -- Hero Illustration */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
            className="rounded-2xl overflow-hidden"
            style={{ boxShadow: 'var(--shadow-neu-raised)' }}
          >
            <img
              src="/img/hero-portdaddy.png"
              alt="Port Daddy — the harbormaster for your AI agents"
              className="w-full h-auto block"
            />
          </motion.div>
        </div>
      </div>

      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
