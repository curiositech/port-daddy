import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Shield, Key, Users, Anchor, Activity } from 'lucide-react'

const CAPABILITIES = [
  { cap: 'code:read', color: 'var(--brand-primary)' },
  { cap: 'notes:write', color: 'var(--brand-primary)' },
  { cap: 'tunnel:create', color: 'var(--brand-accent)' },
  { cap: 'lock:acquire', color: 'var(--brand-accent)' },
  { cap: 'msg:publish', color: 'var(--status-success)' },
  { cap: 'file:claim', color: 'var(--status-success)' },
]

function HarborCard({ name, capabilities, delay = 0 }: { name: string; capabilities: string[]; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <Surface depth="raised" radius="4xl" padding="xl" className="relative overflow-hidden group w-full max-w-md mx-auto p-5 sm:p-8 lg:p-10">
        <motion.div
          className="absolute top-0 right-0 w-32 h-32 opacity-[0.03] blur-3xl group-hover:opacity-[0.08] transition-opacity"
          style={{ background: 'var(--brand-primary)' }}
        />
        <motion.div className="flex items-center gap-5 mb-8">
          <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Anchor style={{ color: 'var(--brand-primary)' }} size={28} />
          </Surface>
          <motion.div className="flex flex-col items-start">
            <motion.span className="text-[12px] font-black uppercase tracking-[0.2em] opacity-80" style={{ color: 'var(--text-muted)' }}>Namespace</motion.span>
            <motion.span className="text-2xl font-display font-black" style={{ color: 'var(--text-primary)' }}>{name}</motion.span>
          </motion.div>
        </motion.div>

        <motion.div className="space-y-4">
          <motion.span className="text-[12px] font-black uppercase tracking-[0.2em] opacity-80 mb-2 block text-left" style={{ color: 'var(--text-muted)' }}>Signed Capabilities <span className="normal-case tracking-normal opacity-60">(advisory in v3)</span></motion.span>
          <motion.div className="flex flex-wrap gap-2">
            {capabilities.map((cap, i) => {
              const config = CAPABILITIES.find(c => c.cap === cap) || CAPABILITIES[0]
              return (
                <span
                  key={i}
                  className="px-4 py-2 rounded-[var(--radius-lg)] text-[12px] font-black uppercase tracking-widest"
                  style={{
                    background: 'var(--surface-sunken)',
                    boxShadow: 'var(--shadow-inset)',
                    color: config.color,
                  }}
                >
                  {cap}
                </span>
              )
            })}
          </motion.div>
        </motion.div>

        <motion.div className="mt-10 pt-8 flex items-center justify-between" style={{ borderTop: '1px solid var(--border-subtle)' }}>
           <motion.div className="flex items-center gap-2">
              <Key size={14} style={{ color: 'var(--brand-accent)' }} />
              <motion.span className="text-[12px] font-mono font-bold opacity-80" style={{ color: 'var(--text-muted)' }}>HMAC-SHA256</motion.span>
           </motion.div>
           <Badge variant="teal" className="px-3 py-1 text-[12px] font-black uppercase tracking-widest">Valid</Badge>
        </motion.div>
      </Surface>
    </motion.div>
  )
}

export function HarborsSection() {
  return (
    <motion.section
      id="harbors"
      className="py-16 lg:py-24 px-6 lg:px-8 font-sans relative overflow-hidden flex flex-col items-center text-center"
      style={{ background: 'var(--surface-base)' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-5xl mx-auto font-sans relative z-10 text-center flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="space-y-8 mb-16 flex flex-col items-center"
        >
          <div className="flex flex-col items-center gap-6">
             <Badge variant="teal" className="px-6 py-2 text-[12px] font-black uppercase tracking-[0.25em]">Security Architecture</Badge>
             <motion.h2 className="text-4xl sm:text-6xl font-bold font-display tracking-tight leading-[0.9] m-0" style={{ color: 'var(--text-primary)' }}>
               Cryptographic <br />
               <motion.span style={{ color: 'var(--brand-primary)' }}>Harbors.</motion.span>
             </motion.h2>
             <motion.p className="text-base max-w-2xl mx-auto leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
               Harbors group agents into named permission namespaces with HMAC-signed capability tokens. In v3, capabilities are advisory -- the daemon tracks declarations but does not block access. Enforced boundaries ship in v4.
             </motion.p>
          </div>
        </motion.div>

          <motion.div className="grid sm:grid-cols-2 gap-8 w-full pt-8">
             {/* Always-On Avatars card */}
             <Surface depth="raised" radius="4xl" padding="xl" className="space-y-6 flex flex-col items-center p-5 sm:p-8 lg:p-10">
                <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center">
                   <Shield style={{ color: 'var(--brand-primary)' }} size={28} />
                </Surface>
                <div className="space-y-2">
                   <motion.h3 className="text-2xl font-display font-black m-0 text-center" style={{ color: 'var(--text-primary)' }}>Always-On Avatars (v4)</motion.h3>
                   <motion.p className="text-base m-0 leading-relaxed text-center" style={{ color: 'var(--text-muted)' }}>Will maintain persistent, harbor-scoped state across sessions.</motion.p>
                </div>
             </Surface>
             {/* Background Teams card */}
             <Surface depth="raised" radius="4xl" padding="xl" className="space-y-6 flex flex-col items-center p-5 sm:p-8 lg:p-10">
                <Surface depth="inset" radius="2xl" padding="none" className="w-14 h-14 flex items-center justify-center">
                   <Users style={{ color: 'var(--brand-accent)' }} size={28} />
                </Surface>
                <div className="space-y-2">
                   <motion.h3 className="text-2xl font-display font-black m-0 text-center" style={{ color: 'var(--text-primary)' }}>Background Teams (Planned)</motion.h3>
                   <motion.p className="text-base m-0 leading-relaxed text-center" style={{ color: 'var(--text-muted)' }}>Will orchestrate groups of agents that coordinate to solve complex infra tasks.</motion.p>
                </div>
             </Surface>
          </motion.div>

        <motion.div className="w-full relative flex flex-col items-center gap-8">
           <motion.div className="absolute inset-0 opacity-[0.05] blur-[140px] rounded-full pointer-events-none" style={{ background: 'var(--brand-primary)' }} />
           <motion.div className="relative flex flex-col md:flex-row items-center justify-center gap-8 w-full">
              <HarborCard
                name="frontend-harbor"
                capabilities={['msg:publish', 'file:claim']}
                delay={0.1}
              />
              <motion.div className="shrink-0 flex items-center justify-center opacity-20">
                 <div className="w-12 h-[2px] hidden md:block" style={{ background: 'linear-gradient(to right, transparent, var(--brand-accent), transparent)' }} />
                 <div className="h-12 w-[2px] md:hidden" style={{ background: 'linear-gradient(to bottom, transparent, var(--brand-accent), transparent)' }} />
              </motion.div>
              <HarborCard
                name="system-architect"
                capabilities={['code:read', 'notes:write', 'tunnel:create']}
                delay={0.2}
              />
           </motion.div>

           {/* Verification badge in inset pill */}
           <motion.div
             className="flex items-center gap-3 px-8 py-4 rounded-full mt-8"
             style={{
               background: 'var(--surface-sunken)',
               boxShadow: 'var(--shadow-inset)',
             }}
             initial={{ opacity: 0 }}
             whileInView={{ opacity: 1 }}
             viewport={{ once: true }}
           >
              <Activity size={16} style={{ color: 'var(--brand-primary)' }} />
              <motion.span className="text-[12px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>HMAC Webhook Signing: Active</motion.span>
           </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
