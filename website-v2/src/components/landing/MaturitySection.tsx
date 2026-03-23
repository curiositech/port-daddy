import { Badge } from '@/components/ui/Badge'
<<<<<<< HEAD
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
=======
import { ShieldCheck, Lock, Activity, Database, Network, RefreshCw } from 'lucide-react'

const MATURITY_FEATURES = [
  {
    icon: Database,
    title: 'SQLite-Backed with WAL',
    description: 'All state is persisted to SQLite with WAL mode for concurrent reads. Atomic operations ensure no race conditions between agents.',
    color: 'var(--p-blue-400)'
  },
  {
    icon: Lock,
    title: 'Harbors (Advisory)',
    description: 'Named permission namespaces with HMAC-signed tokens. Harbors record intent and enable discovery. Enforcement is advisory in the current version.',
    color: 'var(--p-amber-400)'
  },
  {
    icon: Activity,
    title: 'Append-Only Audit Log',
    description: 'Every port claim, session note, and pub/sub message is persisted to an immutable activity log. Agents cannot delete their own history.',
    color: 'var(--p-teal-400)'
  },
  {
    icon: RefreshCw,
    title: 'Session Salvage',
    description: 'When agents crash, their session notes and file claims are preserved in the salvage queue. New agents can pick up where dead ones left off.',
    color: 'var(--p-green-400)'
  },
  {
    icon: ShieldCheck,
    title: 'Pre-Commit Guards',
    description: 'Built-in git hooks prevent accidental file deletion, code gutting, and database commits. Catches mistakes before they land.',
    color: 'var(--p-red-400)'
  },
  {
    icon: Network,
    title: 'Unix Socket + TCP',
    description: 'Native Unix Sockets for local performance with TCP fallback for cross-platform compatibility. The daemon is always-on via launchd.',
    color: 'var(--p-purple-400)'
>>>>>>> worktree-agent-ae9460d3
  }
]

export function MaturitySection() {
  return (
<<<<<<< HEAD
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
=======
    <motion.section
      className="py-24 px-6 sm:px-8 lg:px-10 bg-[var(--bg-surface)] border-t border-b border-[var(--border-subtle)] relative overflow-hidden font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans text-center flex flex-col items-center">
        <motion.div className="mb-16 font-sans flex flex-col items-center gap-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="neutral" className="px-6 py-2 uppercase tracking-[0.25em] text-[10px] font-black shadow-xl">Infrastructure Maturity</Badge>
          </motion.div>
          <motion.h2
            className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[0.9] m-0"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Built for <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Reliability.</motion.span>
          </motion.h2>
          <motion.p
            className="text-2xl sm:text-3xl text-[var(--text-secondary)] max-w-4xl mx-auto leading-relaxed font-sans opacity-80"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Port Daddy is a local daemon that runs persistently via launchd. SQLite for state, append-only logs for audit, and crash recovery built in.
          </motion.p>
        </motion.div>
>>>>>>> worktree-agent-ae9460d3

        {/* Features Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {MATURITY_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
<<<<<<< HEAD
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
=======
              <motion.div
                className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-10"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
                whileHover={{ y: -12, borderColor: feature.color, boxShadow: `0 40px 80px -20px ${feature.color}15` }}
              >
                <motion.div
                  className="w-20 h-20 rounded-[32px] flex items-center justify-center border transition-all group-hover:scale-110"
                  style={{ background: `${feature.color}10`, borderColor: `${feature.color}20` }}
                >
                  <feature.icon size={40} style={{ color: feature.color }} />
                </motion.div>

                <div className="space-y-4 flex-1">
                  <motion.h3 className="m-0 text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                    {feature.title}
                  </motion.h3>
                  <motion.p className="m-0 text-lg opacity-80 leading-relaxed text-[var(--text-secondary)] group-hover:opacity-100 transition-opacity">
                    {feature.description}
                  </motion.p>
                </div>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </motion.div>
    </motion.section>
>>>>>>> worktree-agent-ae9460d3
  )
}
