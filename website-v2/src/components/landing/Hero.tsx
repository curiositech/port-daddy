import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import { ArrowRight, Terminal, Zap, Shield, Cpu } from 'lucide-react'

const HIGHLIGHTS = [
  {
    icon: Zap,
    label: 'Zero Port Conflicts',
    text: 'Deterministic assignment. Same identity, same port, every time.',
  },
  {
    icon: Shield,
    label: 'Crash Recovery',
    text: 'Dead agents get resurrected. Their work is preserved, not lost.',
  },
  {
    icon: Cpu,
    label: 'MCP-Native',
    text: 'Your LLM spawns, monitors, and coordinates agents directly.',
  },
]

export function Hero() {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
      {/* Background: gradient glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 1000px 600px at 50% -100px, rgba(13, 148, 136, 0.12) 0%, transparent 70%)
          `
        }}
      />

      <div className="relative z-10 max-w-[900px] mx-auto px-6 lg:px-8 text-center">
        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold tracking-tight leading-[1.1] mb-6">
          Stop your AI agents from
          <br className="hidden sm:block" />
          <span className="text-primary"> fighting each other.</span>
        </h1>

        <p className="text-base sm:text-lg max-w-xl mx-auto mb-10 leading-relaxed opacity-70">
          Port Daddy is a local daemon that gives every agent its own port,
          coordinates their work, and recovers when they crash. One install. Zero config.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <Button
            size="lg"
            className="gap-2"
            onClick={() => setIsModalOpen(true)}
          >
            <Terminal size={18} />
            Get Started
            <ArrowRight size={18} />
          </Button>
          <Link to="/docs">
            <Button variant="outline" size="lg">
              Read the Docs
            </Button>
          </Link>
        </div>

        {/* Install Command */}
        <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/50 border border-border font-mono text-sm mb-16">
          <Terminal size={14} className="opacity-40" />
          <span className="opacity-60">brew install erichowens/port-daddy</span>
        </div>

        {/* Feature Cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          {HIGHLIGHTS.map((item, i) => (
            <div
              key={i}
              className="p-5 rounded-xl bg-card border border-border text-left transition-all hover:border-primary/30 hover:shadow-[0_4px_24px_rgba(13,148,136,0.1)]"
            >
              <item.icon size={20} className="text-primary mb-3" />
              <h3 className="text-sm font-semibold mb-1">
                {item.label}
              </h3>
              <p className="text-sm opacity-60 leading-relaxed">
                {item.text}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Intent Modal */}
      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
