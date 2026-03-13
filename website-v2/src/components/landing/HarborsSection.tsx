import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Shield, Key, Users, Anchor, Zap, Activity } from 'lucide-react'

const CAPABILITIES = [
  { cap: 'code:read', color: 'var(--p-teal-300)', bg: 'rgba(58,173,173,0.10)' },
  { cap: 'notes:write', color: 'var(--p-teal-300)', bg: 'rgba(58,173,173,0.10)' },
  { cap: 'tunnel:create', color: 'var(--p-amber-300)', bg: 'rgba(251,191,36,0.10)' },
  { cap: 'lock:acquire', color: 'var(--p-amber-300)', bg: 'rgba(251,191,36,0.10)' },
  { cap: 'msg:publish', color: 'var(--p-green-300)', bg: 'rgba(34,197,94,0.10)' },
  { cap: 'file:claim', color: 'var(--p-green-300)', bg: 'rgba(34,197,94,0.10)' },
]

function HarborCard({ name, capabilities, delay = 0 }: { name: string; capabilities: string[]; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className="p-10 rounded-[48px] border border-[var(--border-strong)] relative overflow-hidden group shadow-2xl w-full max-w-md mx-auto"
      style={{ background: 'var(--bg-surface)' }}
    >
      <motion.div 
        className="absolute top-0 right-0 w-32 h-32 bg-[var(--brand-primary)] opacity-[0.03] blur-3xl group-hover:opacity-[0.08] transition-opacity"
      />
      <motion.div className="flex items-center gap-5 mb-8">
        <motion.div className="w-14 h-14 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:border-[var(--brand-primary)] transition-colors">
          <Anchor className="text-[var(--brand-primary)]" size={28} />
        </motion.div>
        <motion.div className="flex flex-col items-start">
          <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Namespace</motion.span>
          <motion.span className="text-2xl font-display font-black text-[var(--text-primary)]">{name}</motion.span>
        </motion.div>
      </motion.div>

      <motion.div className="space-y-4">
        <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2 block text-left">Signed Capabilities</motion.span>
        <motion.div className="flex flex-wrap gap-2">
          {capabilities.map((cap, i) => {
            const config = CAPABILITIES.find(c => c.cap === cap) || CAPABILITIES[0]
            return (
              <motion.div
                key={i}
                className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border"
                style={{ background: config.bg, color: config.color, borderColor: `${config.color}20` }}
              >
                {cap}
              </motion.div>
            )
          })}
        </motion.div>
      </motion.div>

      <motion.div className="mt-10 pt-8 border-t border-[var(--border-subtle)] flex items-center justify-between">
         <motion.div className="flex items-center gap-2">
            <Key size={14} className="text-[var(--p-amber-400)]" />
            <motion.span className="text-[10px] font-mono font-bold opacity-40">HMAC-SHA256</motion.span>
         </motion.div>
         <Badge variant="teal" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest">Valid</Badge>
      </motion.div>
    </motion.div>
  )
}

export function HarborsSection() {
  return (
    <motion.section 
      id="harbors" 
      className="py-48 px-6 sm:px-8 lg:px-10 font-sans relative overflow-hidden"
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
          className="space-y-12 mb-32"
        >
          <div className="flex flex-col items-center gap-6">
             <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Security Architecture</Badge>
             <motion.h2 className="text-6xl sm:text-9xl font-bold font-display tracking-tight leading-[0.9] m-0" style={{ color: 'var(--text-primary)' }}>
               Cryptographic <br />
               <motion.span className="text-[var(--brand-primary)]">Harbors.</motion.span>
             </motion.h2>
          </div>
          <motion.p className="text-2xl sm:text-3xl leading-relaxed font-sans opacity-70 max-w-3xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Stop running agents with root access. Harbors allow you to define strictly scoped permission namespaces for every process in your swarm.
          </motion.p>

          <motion.div className="grid sm:grid-cols-2 gap-10 w-full pt-8">
             <motion.div className="space-y-6 p-10 rounded-[48px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col items-center shadow-xl">
                <motion.div className="w-14 h-14 rounded-2xl bg-[var(--p-teal-500)]/10 flex items-center justify-center shadow-lg">
                   <Shield className="text-[var(--p-teal-400)]" size={28} />
                </motion.div>
                <div className="space-y-2">
                   <motion.h3 className="text-2xl font-display font-black m-0 text-[var(--text-primary)] text-center">Always-On Avatars</motion.h3>
                   <motion.p className="text-base opacity-60 m-0 leading-relaxed text-center">Persistent processes that maintain harbor-scoped state across sessions.</motion.p>
                </div>
             </motion.div>
             <motion.div className="space-y-6 p-10 rounded-[48px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-col items-center shadow-xl">
                <motion.div className="w-14 h-14 rounded-2xl bg-[var(--p-amber-500)]/10 flex items-center justify-center shadow-lg">
                   <Users className="text-[var(--p-amber-400)]" size={28} />
                </motion.div>
                <div className="space-y-2">
                   <motion.h3 className="text-2xl font-display font-black m-0 text-[var(--text-primary)] text-center">Background Teams</motion.h3>
                   <motion.p className="text-base opacity-60 m-0 leading-relaxed text-center">Orchestrate groups of agents that coordinate to solve complex infra tasks.</motion.p>
                </div>
             </motion.div>
          </motion.div>
        </motion.div>

        <motion.div className="w-full relative flex flex-col items-center gap-12">
           <motion.div className="absolute inset-0 bg-[var(--brand-primary)] opacity-[0.05] blur-[140px] rounded-full pointer-events-none" />
           <motion.div className="relative flex flex-col md:flex-row items-center justify-center gap-12 w-full">
              <HarborCard 
                name="frontend-harbor" 
                capabilities={['msg:publish', 'file:claim']} 
                delay={0.1}
              />
              <motion.div className="shrink-0 flex items-center justify-center opacity-20">
                 <div className="w-12 h-[2px] bg-gradient-to-r from-transparent via-[var(--brand-primary)] to-transparent hidden md:block" />
                 <div className="h-12 w-[2px] bg-gradient-to-b from-transparent via-[var(--brand-primary)] to-transparent md:hidden" />
              </motion.div>
              <HarborCard 
                name="system-architect" 
                capabilities={['code:read', 'notes:write', 'tunnel:create']} 
                delay={0.2}
              />
           </motion.div>
           
           <motion.div 
             className="flex items-center gap-3 px-8 py-4 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-subtle)] mt-12"
             initial={{ opacity: 0 }}
             whileInView={{ opacity: 1 }}
             viewport={{ once: true }}
           >
              <Activity size={16} className="text-[var(--p-teal-400)]" />
              <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] opacity-40">Formal Verification: Active</motion.span>
           </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
