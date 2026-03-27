import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Link } from 'react-router-dom'
import { BLUEPRINTS } from '@/data/blueprints'
import { ArrowRight, Code, Search, Network, Shield, Cpu, Zap, Share2, Globe, Radio } from 'lucide-react'

const ICON_MAP: Record<string, typeof Code> = {
  pipeline: Zap,
  research: Search,
  multiplayer: Network,
  ops: Shield,
  swarm: Share2,
  remote: Cpu
}

export function BlueprintsSection() {
  return (
    <section className="py-24 lg:py-32 bg-[var(--bg-surface)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <Badge variant="teal" className="mb-4">Standard Templates</Badge>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
              Deploy your first <span className="text-[var(--brand-primary)]">Agentic Swarm</span>
            </h2>
            <p className="text-lg text-[var(--text-secondary)]">
              Do not start from zero. Use these high-fidelity blueprints to launch complex, self-healing coordination patterns in seconds.
            </p>
          </div>

          <Link to="/templates">
            <Button variant="secondary" className="gap-2">
              View Library
              <ArrowRight size={16} />
            </Button>
          </Link>
        </div>

        {/* Blueprints Grid */}
        <div className="grid sm:grid-cols-2 gap-6 mb-16">
          {BLUEPRINTS.map((blueprint) => {
            const Icon = ICON_MAP[blueprint.hero] || Code
            return (
              <Link
                key={blueprint.id}
                to={`/templates/${blueprint.id}`}
                className="group block p-6 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] hover:border-[var(--brand-primary)] hover:shadow-[var(--shadow-md)] transition-all"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--interactive-hover)] flex items-center justify-center group-hover:bg-[var(--interactive-active)] transition-colors">
                    <Icon size={24} className="text-[var(--brand-primary)]" />
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {blueprint.tags.slice(0, 3).map(tag => (
                      <Badge key={tag} variant="default">{tag}</Badge>
                    ))}
                  </div>
                </div>

                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                  {blueprint.title}
                </h3>
                <p className="text-[var(--text-muted)] leading-relaxed mb-4">
                  {blueprint.description}
                </p>

                <div className="flex items-center justify-between pt-4 border-t border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[var(--success)]" />
                    <span className="text-xs font-medium text-[var(--text-muted)]">Ready to Spawn</span>
                  </div>
                  <span className="text-sm font-medium text-[var(--brand-primary)] group-hover:gap-3 transition-all flex items-center gap-2">
                    Inspect
                    <ArrowRight size={14} />
                  </span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Framework Support */}
        <div className="p-8 lg:p-12 rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)]">
          <div className="text-center mb-10">
            <Badge variant="gold" className="mb-4">Framework Support</Badge>
            <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)] mb-3">
              Built for <span className="text-[var(--warning)]">LangChain</span> & <span className="text-[var(--brand-primary)]">CrewAI</span>
            </h3>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
              Port Daddy provides the low-level discovery logic that high-level frameworks lack. Whether you are building tool-calling swarms or hierarchical workforces.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            {[
              { title: 'Semantic DNS', desc: 'No more hardcoded IPs in your LangChain tools.', icon: Globe },
              { title: 'Crypto Auth', desc: 'Secure your CrewAI members with HMAC-signed cards.', icon: Shield },
              { title: 'Swarm Radio', desc: 'Low-latency inter-agent signaling for state sync.', icon: Radio }
            ].map((item, i) => (
              <div key={i} className="p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center">
                <div className="w-10 h-10 rounded-lg bg-[var(--interactive-hover)] flex items-center justify-center mx-auto mb-3">
                  <item.icon size={20} className="text-[var(--brand-primary)]" />
                </div>
                <h4 className="font-semibold text-[var(--text-primary)] mb-1">{item.title}</h4>
                <p className="text-sm text-[var(--text-muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
