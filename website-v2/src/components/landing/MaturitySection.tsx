import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { ShieldCheck, Lock, Activity, Scale, Zap, Database, Network } from 'lucide-react'

const MATURITY_FEATURES = [
  { 
    icon: ShieldCheck, 
    title: 'E2EE Networking', 
    description: 'V4 Anchor Protocol provides end-to-end encrypted tunnels via Noise Protocol (Noise_XX) over Lighthouses. Your agent data never touches our servers.',
    color: 'var(--p-teal-400)'
  },
  { 
    icon: Lock, 
    title: 'Cryptographic Harbors', 
    description: 'Enforce permission boundaries at the daemon level. Agents without valid HMAC-signed tokens are strictly blocked from sensitive system-level resources.',
    color: 'var(--p-amber-400)'
  },
  { 
    icon: Database, 
    title: 'Immutable Auditing', 
    description: 'Every port claim, note, and message is persisted to an append-only SQLite log. Perfect for compliance, forensics, and swarm post-mortems.',
    color: 'var(--p-blue-400)'
  },
  { 
    icon: Scale, 
    title: 'Resource Enforcement', 
    description: 'Monitor real-time agent compute usage. Auto-salvage rogue processes that exceed memory or CPU quotas before they impact your host machine.',
    color: 'var(--p-red-400)'
  },
  { 
    icon: Activity, 
    title: 'High-Availability Daemon', 
    description: 'The Port Daddy core features zero-downtime reloads and WAL-mode persistence, ensuring your lighthouses stay lit even during host updates.',
    color: 'var(--p-green-400)'
  },
  { 
    icon: Network, 
    title: 'Universal Mesh Core', 
    description: 'Native Unix Sockets for peak local performance, falling back to secure TCP/Named Pipes for Windows, WSL2, and isolated container environments.',
    color: 'var(--p-purple-400)'
  }
]

export function MaturitySection() {
  return (
    <motion.section 
      className="py-32 px-4 sm:px-6 lg:px-8 bg-[var(--bg-surface)] border-t border-b border-[var(--border-subtle)] relative overflow-hidden font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      {/* Background kinetic art */}
      <motion.div 
        className="absolute top-0 right-0 p-20 opacity-[0.03] pointer-events-none"
        animate={{ rotate: 360 }}
        transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
      >
        <Scale size={800} />
      </motion.div>
      
      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans">
        <motion.div className="text-center mb-32 font-sans">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="neutral" className="mb-10 px-6 py-2 uppercase tracking-[0.25em] text-[10px] font-black shadow-xl">Infrastructure Maturity</Badge>
          </motion.div>
          <motion.h2 
            className="text-5xl sm:text-8xl font-black tracking-tighter font-display mb-10 leading-[0.95]"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Production-grade <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Agentic Reliability.</motion.span>
          </motion.h2>
          <motion.p 
            className="text-xl sm:text-2xl text-[var(--text-secondary)] max-w-4xl mx-auto leading-relaxed font-sans opacity-70"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Stop relying on fragile shell scripts. Port Daddy brings the same rigor to agent swarms 
            that Kubernetes brought to container orchestration.
          </motion.p>
        </motion.div>

        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-10">
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
                className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-10"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-base)' }}
                whileHover={{ y: -12, borderColor: feature.color, boxShadow: `0 40px 80px -20px ${feature.color}15` }}
              >
                <motion.div 
                  className="w-20 h-20 rounded-[32px] flex items-center justify-center border transition-all group-hover:scale-110"
                  style={{ background: `${feature.color}10`, borderColor: `${feature.color}20` }}
                >
                  <feature.icon size={40} style={{ color: feature.color }} />
                </motion.div>

                <motion.div className="space-y-4 flex-1">
                  <motion.h3 className="m-0 text-3xl font-display font-black leading-tight text-[var(--text-primary)]">
                    {feature.title}
                  </motion.h3>
                  <motion.p className="m-0 text-lg opacity-60 leading-relaxed text-[var(--text-secondary)] group-hover:opacity-100 transition-opacity">
                    {feature.description}
                  </motion.p>
                </motion.div>

                <motion.div className="w-full flex items-center justify-between pt-8 border-t border-[var(--border-subtle)] group-hover:border-transparent transition-colors">
                   <motion.div className="flex items-center gap-3">
                      <motion.div className="w-2 h-2 rounded-full opacity-20 group-hover:opacity-100 transition-opacity" style={{ background: feature.color }} />
                      <motion.span className="text-[9px] font-black uppercase tracking-widest opacity-30 group-hover:opacity-60">V4 Specs Included</motion.span>
                   </motion.div>
                </motion.div>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>

        {/* Impressively long call to stability */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-overlay)] flex flex-col lg:flex-row items-center gap-16 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <ShieldCheck size={600} />
           </motion.div>

           <motion.div className="flex-1 space-y-8 relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Formal Verification</Badge>
              <motion.h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Soundness by <motion.span className="text-[var(--p-teal-400)]">Design.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-70">
                We are formally verifying the Anchor Protocol using ProVerif to ensure zero "executable attack paths" in the harbor handshake. Your swarm's security isn't an afterthought—it's mathematically proven.
              </motion.p>
              <motion.div className="flex flex-wrap gap-6 pt-4">
                 <motion.div className="flex items-center gap-3 px-6 py-3 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <Zap size={16} className="text-[var(--p-amber-400)]" />
                    <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-60 text-[var(--text-primary)]">ProVerif 2.05 Validated</motion.span>
                 </motion.div>
                 <motion.div className="flex items-center gap-3 px-6 py-3 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                    <Activity size={16} className="text-[var(--p-teal-400)]" />
                    <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-60 text-[var(--text-primary)]">HS256 Enforced</motion.span>
                 </motion.div>
              </motion.div>
           </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
