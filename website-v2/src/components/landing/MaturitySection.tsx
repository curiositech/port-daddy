import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import {
  ShieldCheck, Lock, Activity, Scale,
  Zap, Database, Network
} from 'lucide-react'

const MATURITY_FEATURES = [
  {
    icon: ShieldCheck,
    title: 'E2EE Networking',
    description: 'V4 Anchor Protocol provides end-to-end encrypted tunnels via Noise Protocol (Noise_XX) over Lighthouses. Your agent data never touches our servers.',
  },
  {
    icon: Lock,
    title: 'Cryptographic Harbors',
    description: 'Enforce permission boundaries at the daemon level. Agents without valid HMAC-signed tokens are strictly blocked from sensitive system-level resources.',
  },
  {
    icon: Database,
    title: 'Immutable Auditing',
    description: 'Every port claim, note, and message is persisted to an append-only SQLite log. Perfect for compliance, forensics, and swarm post-mortems.',
  },
  {
    icon: Scale,
    title: 'Resource Enforcement',
    description: 'Monitor real-time agent compute usage. Auto-salvage rogue processes that exceed memory or CPU quotas before they impact your host machine.',
  },
  {
    icon: Activity,
    title: 'High-Availability Daemon',
    description: 'The Port Daddy core features zero-downtime reloads and WAL-mode persistence, ensuring your lighthouses stay lit even during host updates.',
  },
  {
    icon: Network,
    title: 'Universal Mesh Core',
    description: 'Native Unix Sockets for peak local performance, falling back to secure TCP/Named Pipes for Windows, WSL2, and isolated container environments.',
  }
]

export function MaturitySection() {
  return (
    <motion.section
      className="py-24 px-6 sm:px-8 lg:px-10 relative overflow-hidden font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      {/* Background kinetic art */}
      <motion.div
        className="absolute top-0 right-0 p-20 opacity-[0.03] pointer-events-none"
        style={{ color: 'var(--text-muted)' }}
        animate={{ rotate: 360 }}
        transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
      >
        <Scale size={800} />
      </motion.div>

      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans text-center flex flex-col items-center">
        <motion.div className="mb-16 font-sans flex flex-col items-center gap-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <Badge variant="default" className="px-6 py-2 uppercase tracking-[0.25em] text-[10px] font-black">Infrastructure Maturity</Badge>
          </motion.div>
          <motion.h2
            className="text-5xl sm:text-7xl font-black tracking-tighter font-display leading-[0.9] m-0"
            style={{ color: 'var(--text-primary)' }}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            Production-grade <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Agentic Reliability.</motion.span>
          </motion.h2>
          <motion.p
            className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans opacity-80"
            style={{ color: 'var(--text-secondary)' }}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.1 }}
          >
            Stop relying on fragile shell scripts. Port Daddy brings the same rigor to agent swarms
            that Kubernetes brought to container orchestration.
          </motion.p>
        </motion.div>

        {/* Features Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {MATURITY_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group p-6 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <motion.div
                className="h-full p-12 rounded-[56px] transition-all duration-300 flex flex-col items-center text-center gap-10"
                style={{
                  background: 'var(--surface-raised)',
                  boxShadow: 'var(--shadow-raised)',
                }}
                whileHover={{ y: -12, boxShadow: 'var(--shadow-sm)' }}
              >
                {/* Icon in inset circle */}
                <motion.div
                  className="w-20 h-20 rounded-[32px] flex items-center justify-center transition-all group-hover:scale-110"
                  style={{
                    background: 'var(--surface-base)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                  <feature.icon size={40} style={{ color: 'var(--brand-accent)' }} />
                </motion.div>

                <div className="space-y-4 flex-1">
                  <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {feature.title}
                  </motion.h3>
                  <motion.p className="m-0 text-lg opacity-80 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                    {feature.description}
                  </motion.p>
                </div>

                {/* Maturity badge in inset surface */}
                <motion.div
                  className="w-full flex items-center justify-center pt-8"
                >
                   <motion.div
                     className="flex items-center gap-3 px-6 py-3 rounded-full"
                     style={{
                       background: 'var(--surface-sunken)',
                       boxShadow: 'var(--shadow-inset)',
                     }}
                   >
                      <motion.div className="w-2 h-2 rounded-full opacity-20 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--brand-primary)' }} />
                      <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-muted)' }}>V4 Specs Included</motion.span>
                   </motion.div>
                </motion.div>
              </motion.div>
            </div>
          ))}
        </div>

        {/* Call to stability */}
        <motion.div
          className="mt-24 p-20 rounded-[80px] flex flex-col items-center text-center gap-12 relative overflow-hidden w-full"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <ShieldCheck size={600} style={{ color: 'var(--text-muted)' }} />
           </div>

           <div className="space-y-8 relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Formal Verification</Badge>
              <motion.h3 className="text-5xl sm:text-7xl font-display font-black tracking-tight leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                Soundness by <motion.span style={{ color: 'var(--brand-primary)' }}>Design.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-80 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
                We are formally verifying the Anchor Protocol using ProVerif to ensure zero "executable attack paths" in the harbor handshake. Your swarm's security isn't an afterthought--it's mathematically proven.
              </motion.p>
              <motion.div className="flex flex-wrap justify-center gap-8 pt-6">
                 <motion.div
                   className="flex items-center gap-3 px-8 py-4 rounded-full"
                   style={{
                     background: 'var(--surface-sunken)',
                     boxShadow: 'var(--shadow-inset)',
                   }}
                 >
                    <Zap size={20} style={{ color: 'var(--brand-accent)' }} />
                    <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-80" style={{ color: 'var(--text-primary)' }}>ProVerif 2.05 Validated</motion.span>
                 </motion.div>
                 <motion.div
                   className="flex items-center gap-3 px-8 py-4 rounded-full"
                   style={{
                     background: 'var(--surface-sunken)',
                     boxShadow: 'var(--shadow-inset)',
                   }}
                 >
                    <Activity size={20} style={{ color: 'var(--brand-primary)' }} />
                    <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-80" style={{ color: 'var(--text-primary)' }}>HS256 Enforced</motion.span>
                 </motion.div>
              </motion.div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
