import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import { ArrowRight, Terminal, Copy, Check } from 'lucide-react'

const TERMINAL_LINES = [
  { prompt: true, text: 'brew install erichowens/port-daddy', delay: 0 },
  { prompt: false, text: 'Installing port-daddy v3.7.0...', delay: 600 },
  { prompt: false, text: 'Daemon installed at /usr/local/bin/pd', delay: 1000 },
  { prompt: true, text: 'pd begin --identity myapp:api --purpose "Build the auth layer"', delay: 1800 },
  { prompt: false, text: '● Session started · port 9201 · agent registered', delay: 2400 },
  { prompt: true, text: 'pd claim myapp:frontend', delay: 3200 },
  { prompt: false, text: '● Port 9202 claimed · identity myapp:frontend', delay: 3700 },
  { prompt: true, text: 'pd pub build-ready "API is live on :9201"', delay: 4400 },
  { prompt: false, text: '● Published to build-ready · 2 subscribers notified', delay: 5000 },
]

function AnimatedTerminal() {
  const [visibleLines, setVisibleLines] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const timers = TERMINAL_LINES.map((line, i) =>
      setTimeout(() => setVisibleLines(i + 1), line.delay + 800)
    )
    return () => timers.forEach(clearTimeout)
  }, [])

  const handleCopy = () => {
    navigator.clipboard.writeText('brew install erichowens/port-daddy')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#d0d0d0',
        boxShadow: 'inset 4px 4px 8px #b8b8b8, inset -4px -4px 8px #e8e8e8',
      }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{
          background: '#d6d6d6',
          boxShadow: '0 1px 0 rgba(0,0,0,0.06)',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]/70" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]/70" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]/70" />
        </div>
        <span className="text-[11px] font-mono text-[#888] tracking-wide">port-daddy</span>
        <button
          onClick={handleCopy}
          className="text-[#999] hover:text-[#555] transition-colors cursor-pointer"
          aria-label="Copy install command"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>

      {/* Terminal body */}
      <div className="p-5 font-mono text-[13px] leading-[1.7] min-h-[260px]">
        {TERMINAL_LINES.slice(0, visibleLines).map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={line.prompt ? 'text-[#2d2d2d]' : 'text-[#777]'}
          >
            {line.prompt && <span className="text-[var(--brand-accent)] mr-2">$</span>}
            {!line.prompt && <span className="mr-2">&nbsp;&nbsp;</span>}
            {line.text}
          </motion.div>
        ))}
        {visibleLines < TERMINAL_LINES.length && (
          <span className="inline-block w-[7px] h-[15px] bg-[#0d9488] ml-[18px] animate-pulse" />
        )}
      </div>
    </div>
  )
}

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative flex items-center overflow-hidden pt-32 pb-16 lg:pt-40 lg:pb-24">
      {/* Subtle dot grid on the neumorphic surface */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle, #888 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-8 py-20 lg:py-0">
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
