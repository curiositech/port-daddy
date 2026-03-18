import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PRODUCT_FEATURES } from '@/data/product'
import { 
  Shield, History, Radio, 
  Anchor, Code, Cpu, Terminal, Sparkles, ArrowRight
} from 'lucide-react'
import { Link } from 'react-router-dom'

const ICON_MAP: Record<string, typeof Anchor> = {
  'ports': Anchor,
  'coordination': Radio,
  'security': Shield,
  'observability': History,
  'agents': Cpu,
  'intelligence': Sparkles
}

const CATEGORY_COLORS: Record<string, string> = {
  'ports': 'var(--info)',
  'coordination': 'var(--brand-primary)',
  'security': 'var(--warning)',
  'observability': 'var(--error)',
  'agents': 'var(--success)',
  'intelligence': 'var(--brand-accent)'
}

export function Features() {
  return (
    <section id="features" className="py-16 lg:py-24 bg-[var(--bg-base)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge variant="teal" className="mb-4">The Enumeration</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            The Definitive <span className="text-[var(--brand-primary)]">Control Plane</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Foundational primitives required to turn a collection of scripts into a production-grade, autonomous organization.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {PRODUCT_FEATURES.map((feature) => {
            const Icon = ICON_MAP[feature.category] || Code
            const color = CATEGORY_COLORS[feature.category] || 'var(--brand-primary)'
            
            return (
              <div
                key={feature.id}
                className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
              >
                {/* Icon */}
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                  style={{ background: `${color}15` }}
                >
                  <Icon size={20} style={{ color }} />
                </div>
                
                {/* Title & Badge */}
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-semibold text-[var(--text-primary)]">
                    {feature.title}
                  </h3>
                </div>
                
                {/* Description */}
                <p className="text-sm text-[var(--text-tertiary)] leading-relaxed mb-4">
                  {feature.description}
                </p>

                {/* CLI Snippet */}
                <div className="p-3 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--brand-primary)]">{feature.cli}</span>
                    <Terminal size={12} className="text-[var(--text-muted)]" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        
        {/* Bottom CTA */}
        <div className="mt-12 p-8 lg:p-12 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center">
          <Badge variant="teal" className="mb-4">Deployment Ready</Badge>
          <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)] mb-3">
            One daemon to <span className="text-[var(--brand-primary)]">rule the swarm</span>
          </h3>
          <p className="text-[var(--text-secondary)] max-w-xl mx-auto mb-6">
            Port Daddy is open-source and installs in seconds. Start building your autonomous organization today.
          </p>
          <Link to="/tutorials/getting-started">
            <Button size="lg" className="gap-2">
              Get Started Now
              <ArrowRight size={18} />
            </Button>
          </Link>
        </div>
      </div>
    </section>
  )
}
