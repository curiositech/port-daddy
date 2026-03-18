import { Badge } from '@/components/ui/Badge'
import { 
  ShieldCheck, Lock, Activity, Scale, 
  Zap, Database, Network 
} from 'lucide-react'

const MATURITY_FEATURES = [
  { 
    icon: ShieldCheck, 
    title: 'E2EE Networking', 
    description: 'V4 Anchor Protocol provides end-to-end encrypted tunnels via Noise Protocol over Lighthouses.',
    color: 'var(--brand-primary)'
  },
  { 
    icon: Lock, 
    title: 'Cryptographic Harbors', 
    description: 'Enforce permission boundaries at the daemon level. Agents without valid tokens are blocked.',
    color: 'var(--warning)'
  },
  { 
    icon: Database, 
    title: 'Immutable Auditing', 
    description: 'Every claim, note, and message is persisted to an append-only SQLite log for compliance.',
    color: 'var(--info)'
  },
  { 
    icon: Scale, 
    title: 'Resource Enforcement', 
    description: 'Monitor real-time agent compute usage. Auto-salvage rogue processes before they impact the host.',
    color: 'var(--error)'
  },
  { 
    icon: Activity, 
    title: 'High-Availability Daemon', 
    description: 'Zero-downtime reloads and WAL-mode persistence ensure your lighthouses stay lit.',
    color: 'var(--success)'
  },
  { 
    icon: Network, 
    title: 'Universal Mesh Core', 
    description: 'Native Unix Sockets for local performance, with TCP fallback for Windows and containers.',
    color: '#8b5cf6'
  }
]

export function MaturitySection() {
  return (
    <section className="py-24 lg:py-32 bg-[var(--bg-base)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="neutral" className="mb-4">Infrastructure Maturity</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            Production-grade <span className="text-[var(--brand-primary)]">Reliability</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Stop relying on fragile shell scripts. Port Daddy brings the same rigor to agent swarms that Kubernetes brought to containers.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {MATURITY_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div 
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                style={{ background: `${feature.color}15` }}
              >
                <feature.icon size={20} style={{ color: feature.color }} />
              </div>

              <h3 className="font-semibold text-[var(--text-primary)] mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-[var(--text-tertiary)] leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>

        {/* Formal Verification CTA */}
        <div className="p-8 lg:p-12 rounded-2xl bg-[var(--bg-surface)] border border-dashed border-[var(--border-default)]">
          <div className="text-center mb-8">
            <Badge variant="teal" className="mb-4">Formal Verification</Badge>
            <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)] mb-3">
              Soundness by <span className="text-[var(--brand-primary)]">Design</span>
            </h3>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
              We are formally verifying the Anchor Protocol using ProVerif to ensure zero executable attack paths in the harbor handshake.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-4">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <Zap size={16} className="text-[var(--warning)]" />
              <span className="text-sm font-medium text-[var(--text-secondary)]">ProVerif 2.05 Validated</span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <Activity size={16} className="text-[var(--success)]" />
              <span className="text-sm font-medium text-[var(--text-secondary)]">HS256 Enforced</span>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
              <ShieldCheck size={16} className="text-[var(--brand-primary)]" />
              <span className="text-sm font-medium text-[var(--text-secondary)]">V4 Specs Included</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
