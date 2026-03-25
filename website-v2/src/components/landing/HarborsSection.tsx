import { Badge } from '@/components/ui/Badge'
import { Shield, Key, Users, Anchor, Activity } from 'lucide-react'

const CAPABILITIES = [
  { cap: 'code:read', color: 'var(--brand-primary)' },
  { cap: 'notes:write', color: 'var(--brand-primary)' },
  { cap: 'tunnel:create', color: 'var(--warning)' },
  { cap: 'lock:acquire', color: 'var(--warning)' },
  { cap: 'msg:publish', color: 'var(--success)' },
  { cap: 'file:claim', color: 'var(--success)' },
]

interface HarborCardProps {
  name: string
  capabilities: string[]
}

function HarborCard({ name, capabilities }: HarborCardProps) {
  return (
    <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[var(--shadow-md)]">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-10 h-10 rounded-lg bg-[var(--interactive-hover)] flex items-center justify-center">
          <Anchor size={20} className="text-[var(--brand-primary)]" />
        </div>
        <div>
          <span className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide">Namespace</span>
          <div className="font-semibold text-[var(--text-primary)]">{name}</div>
        </div>
      </div>

      <div className="mb-6">
        <span className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide block mb-3">
          Signed Capabilities
        </span>
        <div className="flex flex-wrap gap-2">
          {capabilities.map((cap, i) => {
            const config = CAPABILITIES.find(c => c.cap === cap) || CAPABILITIES[0]
            return (
              <span
                key={i}
                className="px-2.5 py-1 rounded-md text-[10px] font-medium uppercase tracking-wide"
                style={{ 
                  background: `${config.color}15`,
                  color: config.color
                }}
              >
                {cap}
              </span>
            )
          })}
        </div>
      </div>

      <div className="pt-4 border-t border-[var(--border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={14} className="text-[var(--warning)]" />
          <span className="text-xs font-mono text-[var(--text-tertiary)]">HMAC-SHA256</span>
        </div>
        <Badge variant="teal" size="sm">Valid</Badge>
      </div>
    </div>
  )
}

export function HarborsSection() {
  return (
    <section id="harbors" className="py-24 lg:py-32 bg-[var(--bg-base)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="teal" className="mb-4">Security Architecture</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            Cryptographic <span className="text-[var(--brand-primary)]">Harbors</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Stop running agents with root access. Harbors define strictly scoped permission namespaces for every process.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid sm:grid-cols-2 gap-6 mb-12">
          <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <div className="w-10 h-10 rounded-lg bg-[var(--brand-primary)]/10 flex items-center justify-center mb-4">
              <Shield size={20} className="text-[var(--brand-primary)]" />
            </div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Always-On Avatars</h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              Persistent processes that maintain harbor-scoped state across sessions.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <div className="w-10 h-10 rounded-lg bg-[var(--warning)]/10 flex items-center justify-center mb-4">
              <Users size={20} className="text-[var(--warning)]" />
            </div>
            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Background Teams</h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              Orchestrate groups of agents that coordinate to solve complex infra tasks.
            </p>
          </div>
        </div>

        {/* Harbor Cards */}
        <div className="flex flex-col md:flex-row items-center justify-center gap-6">
          <HarborCard 
            name="frontend-harbor" 
            capabilities={['msg:publish', 'file:claim']} 
          />
          <div className="flex items-center justify-center">
            <div className="hidden md:block w-16 h-[2px] bg-[var(--border-subtle)]" />
            <div className="md:hidden h-8 w-[2px] bg-[var(--border-subtle)]" />
          </div>
          <HarborCard 
            name="system-architect" 
            capabilities={['code:read', 'notes:write', 'tunnel:create']} 
          />
        </div>

        {/* Verification Badge */}
        <div className="flex justify-center mt-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <Activity size={14} className="text-[var(--success)]" />
            <span className="text-xs font-medium text-[var(--text-tertiary)]">
              Formal Verification: Active
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
