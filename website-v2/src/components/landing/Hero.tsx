import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { IntentModal } from '@/components/ui/IntentModal'
import { useTheme } from '@/lib/theme'
import { ArrowRight, Shield, Zap, History, Terminal } from 'lucide-react'
import { MaritimeSignalRow } from '@/components/viz/MaritimeFlags'

const HIGHLIGHTS = [
  { 
    icon: Zap, 
    label: 'Spawn & Coordinate', 
    text: 'Launch agent swarms that discover and wire themselves. No hardcoded ports. No service mesh.',
    color: 'var(--brand-accent)'
  },
  { 
    icon: Shield, 
    label: 'Self-Healing Harbors', 
    text: 'Agents crash. Work gets salvaged. Cryptographic namespaces keep swarms isolated and recoverable.',
    color: 'var(--brand-primary)'
  },
  { 
    icon: History, 
    label: 'MCP-Native', 
    text: 'Built for the Model Context Protocol. Your LLM can spawn, monitor, and coordinate agents directly.',
    color: 'var(--text-secondary)'
  },
]

export function Hero() {
  const { theme } = useTheme()
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <section className="relative flex flex-col items-center justify-center pt-28 pb-12 overflow-hidden">
      {/* Background Grid Pattern */}
      <div className="absolute inset-0 grid-pattern opacity-50" />
      
      {/* Subtle gradient glow */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.03]"
        style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
      />

      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 lg:px-8">
        <div className="flex flex-col items-center text-center gap-6">
          {/* Maritime Signal */}
          <div className="opacity-40">
            <MaritimeSignalRow size={20} />
          </div>
          
          {/* Logo */}
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto">
            <img
              src={theme === 'dark' ? '/pd_logo_darkmode.svg' : '/pd_logo.svg'}
              alt="Port Daddy"
              className="w-full h-full object-contain"
            />
          </div>

          {/* Version Badge */}
          <div className="flex items-center gap-3">
            <Badge variant="teal" size="md">v3.7.0 Stable</Badge>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" />
              <span className="text-xs font-medium text-[var(--text-tertiary)]">Swarm Ready</span>
            </div>
          </div>

          {/* Headline */}
          <div className="space-y-3 max-w-4xl">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-[var(--text-primary)] leading-[1.1]">
              Infrastructure for{' '}
              <span className="text-[var(--brand-primary)]">the Agent Economy</span>
            </h1>
            <p className="text-lg sm:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto leading-relaxed">
              Spawn self-healing agent swarms. Coordinate without chaos. The coordination layer AI-native development was missing.
            </p>
          </div>

          {/* CTAs - Updated with intent modal */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button 
              size="lg" 
              className="gap-2"
              onClick={() => setIsModalOpen(true)}
            >
              <Terminal size={18} />
              Start Building Agents
              <ArrowRight size={18} />
            </Button>
            <Link to="/docs">
              <Button variant="secondary" size="lg">
                Read the Docs
              </Button>
            </Link>
          </div>

          {/* Install Command */}
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm text-[var(--text-secondary)]">
            <Terminal size={16} className="text-[var(--text-muted)]" />
            <span>brew install erichowens/port-daddy</span>
          </div>

          {/* Feature Highlights */}
          <div className="grid sm:grid-cols-3 gap-4 w-full max-w-3xl mt-4">
            {HIGHLIGHTS.map((item, i) => (
              <div
                key={i}
                className="group p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all text-left"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 bg-[var(--bg-overlay)]">
                  <item.icon size={20} style={{ color: item.color }} />
                </div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                  {item.label}
                </h3>
                <p className="text-sm text-[var(--text-tertiary)] leading-relaxed">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Intent Modal */}
      <IntentModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </section>
  )
}
