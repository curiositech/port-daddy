import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import {
  ShieldCheck, Lock, Activity, Scale,
  Zap, Database, Network
} from 'lucide-react'

const MATURITY_FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Local-First Architecture',
    description: 'All coordination happens through a local daemon, discovered from the running install. No cloud dependency, no external services, no data leaving your machine.',
  },
  {
    icon: Lock,
    title: 'Cryptographic Harbors',
    description: 'Define permission boundaries with HMAC-signed capability tokens. In v3, capabilities are advisory -- agents declare intent and the daemon tracks compliance. Enforced boundaries are planned for v4.',
  },
  {
    icon: Database,
    title: 'Immutable Auditing',
    description: 'Every port claim, note, and message is persisted to an append-only SQLite log. Perfect for compliance, forensics, and swarm post-mortems.',
  },
  {
    icon: Scale,
    title: 'Heartbeat Monitoring',
    description: 'Auto-detect dead agents via heartbeat expiry and preserve their session notes and file claims for salvage. New agents inherit context and continue the work.',
  },
  {
    icon: Activity,
    title: 'Always-On Daemon',
    description: 'Installed as a launchd service with auto-restart on crash. WAL-mode SQLite persistence ensures your coordination state survives reboots and host updates.',
  },
  {
    icon: Network,
    title: 'Universal Access',
    description: 'Unix socket for peak local performance, with TCP fallback for compatibility. Connect from any process on the host regardless of runtime or language.',
  }
]

export function MaturitySection() {
  return (
    <motion.section
      className="py-16 lg:py-24 px-6 lg:px-8 relative overflow-hidden font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
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
            <Badge variant="default" className="px-6 py-2 uppercase tracking-[0.25em] text-[12px] font-black">Infrastructure Maturity</Badge>
          </motion.div>
          <motion.h2
            className="text-3xl sm:text-5xl lg:text-7xl font-black tracking-tighter font-display leading-[0.9] m-0"
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
            <div key={feature.title} className="group">
              <motion.div
                className="h-full p-6 sm:p-8 lg:p-12 rounded-[var(--radius-4xl)] transition-all duration-300 flex flex-col items-center text-center gap-10"
                style={{
                  background: 'var(--surface-raised)',
                  boxShadow: 'var(--shadow-raised)',
                }}
                whileHover={{ y: -12, boxShadow: 'var(--shadow-sm)' }}
              >
                {/* Icon in inset circle */}
                <Surface depth="inset" radius="3xl" padding="none" className="w-20 h-20 flex items-center justify-center transition-all group-hover:scale-110">
                  <feature.icon size={40} style={{ color: 'var(--brand-accent)' }} />
                </Surface>

                <div className="space-y-4 flex-1">
                  <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {feature.title}
                  </motion.h3>
                  <motion.p className="m-0 text-lg opacity-80 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                    {feature.description}
                  </motion.p>
                </div>

                {/* Maturity badge in inset surface */}
                <motion.div className="w-full flex items-center justify-center pt-8">
                   <motion.div
                     className="flex items-center gap-3 px-6 py-3 rounded-full"
                     style={{
                       background: 'var(--surface-sunken)',
                       boxShadow: 'var(--shadow-inset)',
                     }}
                   >
                      <motion.div className="w-2 h-2 rounded-full opacity-20 group-hover:opacity-100 transition-opacity" style={{ background: 'var(--brand-primary)' }} />
                      <motion.span className="text-[12px] font-black uppercase tracking-widest opacity-30 group-hover:opacity-80" style={{ color: 'var(--text-muted)' }}>V4 Specs Included</motion.span>
                   </motion.div>
                </motion.div>
              </motion.div>
            </div>
          ))}
        </div>

        {/* Call to stability */}
        <motion.div
          className="mt-24 p-6 sm:p-10 lg:p-20 rounded-[var(--radius-4xl)] flex flex-col items-center text-center gap-12 relative overflow-hidden w-full"
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
              <Badge variant="teal" className="px-6 py-2 text-[12px] font-black uppercase tracking-widest">V4 Roadmap</Badge>
              <motion.h3 className="text-3xl sm:text-5xl lg:text-7xl font-display font-black tracking-tight leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                What's <motion.span style={{ color: 'var(--brand-primary)' }}>Next.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-80 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
                V4 will bring end-to-end encrypted networking via Noise Protocol, formal verification with ProVerif, and enforced harbor permission boundaries. Here's what's on the roadmap.
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
                    <motion.span className="text-[12px] font-black uppercase tracking-widest opacity-80" style={{ color: 'var(--text-primary)' }}>In Development</motion.span>
                 </motion.div>
                 <motion.div
                   className="flex items-center gap-3 px-8 py-4 rounded-full"
                   style={{
                     background: 'var(--surface-sunken)',
                     boxShadow: 'var(--shadow-inset)',
                   }}
                 >
                    <Activity size={20} style={{ color: 'var(--brand-primary)' }} />
                    <motion.span className="text-[12px] font-black uppercase tracking-widest opacity-80" style={{ color: 'var(--text-primary)' }}>Planned for v4</motion.span>
                 </motion.div>
              </motion.div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
