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
    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-[#0a1210] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.8)]">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]/80" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]/80" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]/80" />
        </div>
        <span className="text-[11px] font-mono text-white/25 tracking-wide">port-daddy</span>
        <button
          onClick={handleCopy}
          className="text-white/30 hover:text-white/60 transition-colors cursor-pointer"
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
            className={line.prompt ? 'text-white/90' : 'text-white/40'}
          >
            {line.prompt && <span className="text-[#5eead4] mr-2">$</span>}
            {!line.prompt && <span className="mr-2">&nbsp;&nbsp;</span>}
            {line.text}
          </motion.div>
        ))}
        {visibleLines < TERMINAL_LINES.length && (
          <span className="inline-block w-[7px] h-[15px] bg-[#5eead4] ml-[18px] animate-pulse" />
        )}
      </div>
    </div>
  )
}

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-24">
      {/* Background layers */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: `
          radial-gradient(ellipse 1200px 700px at 30% -10%, rgba(13, 148, 136, 0.1) 0%, transparent 70%),
          radial-gradient(ellipse 600px 400px at 85% 80%, rgba(6, 182, 212, 0.06) 0%, transparent 60%)
        `
      }} />

      {/* Dot grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.035]" style={{
        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-8 py-20 lg:py-0">
        <div className="grid lg:grid-cols-[1fr,1.1fr] gap-12 lg:gap-16 items-center">
          {/* Left — Copy */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
          >
            <p className="text-sm font-mono text-[#5eead4] tracking-wide mb-5 uppercase">
              Multi-agent coordination
            </p>

            <h1 className="text-[2.5rem] sm:text-5xl lg:text-[3.25rem] xl:text-[3.75rem] font-bold tracking-[-0.035em] leading-[1.08] mb-6 text-[var(--text-primary)]">
              Stop your agents from
              {' '}
              <span className="bg-gradient-to-r from-[#5eead4] to-[#0d9488] bg-clip-text text-transparent">
                fighting each other.
              </span>
            </h1>

            <p className="text-base lg:text-lg text-[var(--text-muted)] leading-relaxed mb-8 max-w-lg">
              Port Daddy is a daemon that gives every AI agent its own port, coordinates file access, and recovers work when they crash. One install. Zero config.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                className="gap-2"
                onClick={() => setIsModalOpen(true)}
              >
                <Terminal size={16} />
                Get Started
                <ArrowRight size={16} />
              </Button>
              <Link to="/docs">
                <Button variant="ghost" size="lg" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  Read the Docs
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Right — Terminal */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' as const }}
          >
            <AnimatedTerminal />
          </motion.div>
        </div>
      </div>

      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
