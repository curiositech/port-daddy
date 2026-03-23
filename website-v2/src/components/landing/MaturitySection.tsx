import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
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
  }
]

export function MaturitySection() {
  return (
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

        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12 w-full">
          {MATURITY_FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="group"
            >
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
  )
}
