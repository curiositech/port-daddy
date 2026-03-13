import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Shield, Key, Users, Anchor } from 'lucide-react'

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
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
      className="p-8 rounded-[40px] border border-[var(--border-strong)] relative overflow-hidden group shadow-2xl"
      style={{ background: 'var(--bg-surface)' }}
    >
      <motion.div 
        className="absolute top-0 right-0 w-32 h-32 bg-[var(--brand-primary)] opacity-[0.03] blur-3xl group-hover:opacity-[0.08] transition-opacity"
      />
      <motion.div className="flex items-center gap-4 mb-8">
        <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
          <Anchor className="text-[var(--brand-primary)]" size={24} />
        </motion.div>
        <motion.div className="flex flex-col">
          <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">Namespace</motion.span>
          <motion.span className="text-xl font-display font-black text-[var(--text-primary)]">{name}</motion.span>
        </motion.div>
      </motion.div>

      <motion.div className="space-y-3">
        <motion.span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-2 block">Signed Capabilities</motion.span>
        <motion.div className="flex flex-wrap gap-2">
          {capabilities.map((cap, i) => {
            const config = CAPABILITIES.find(c => c.cap === cap) || CAPABILITIES[0]
            return (
              <motion.div
                key={i}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold border"
                style={{ background: config.bg, color: config.color, borderColor: `${config.color}20` }}
              >
                {cap}
              </motion.div>
            )
          })}
        </motion.div>
      </motion.div>

      <motion.div className="mt-8 pt-6 border-t border-[var(--border-subtle)] flex items-center justify-between">
         <motion.div className="flex items-center gap-2">
            <Key size={12} className="text-[var(--p-amber-400)]" />
            <motion.span className="text-[10px] font-mono opacity-40">HMAC-SHA256</motion.span>
         </motion.div>
         <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">Valid</Badge>
      </motion.div>
    </motion.div>
  )
}

export function HarborsSection() {
  return (
    <motion.section 
      id="harbors" 
      className="py-32 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto font-sans relative z-10">
        <motion.div className="grid lg:grid-cols-2 gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, x: -32 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-10"
          >
            <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Security Architecture</Badge>
            <motion.h2 className="text-5xl sm:text-8xl font-bold font-display tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
              Cryptographic <motion.span className="text-[var(--brand-primary)]">Harbors.</motion.span>
            </motion.h2>
            <motion.p className="text-xl sm:text-2xl leading-relaxed font-sans opacity-70" style={{ color: 'var(--text-secondary)' }}>
              Stop running agents with root access. Harbors allow you to define strictly scoped permission namespaces for every process in your swarm.
            </motion.p>

            <motion.div className="grid sm:grid-cols-2 gap-8">
               <motion.div className="space-y-4 p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                     <Shield className="text-[var(--p-teal-400)]" size={20} />
                  </motion.div>
                  <motion.h3 className="text-xl font-display font-bold m-0 text-[var(--text-primary)]">Always-On Avatars</motion.h3>
                  <motion.p className="text-sm opacity-60 m-0">Persistent, backgrounded processes that maintain harbor-scoped state across sessions.</motion.p>
               </motion.div>
               <motion.div className="space-y-4 p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                  <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                     <Users className="text-[var(--p-amber-400)]" size={20} />
                  </motion.div>
                  <motion.h3 className="text-xl font-display font-bold m-0 text-[var(--text-primary)]">Background Teams</motion.h3>
                  <motion.p className="text-sm opacity-60 m-0">Orchestrate groups of agents that coordinate inside a single harbor to solve complex infra tasks.</motion.p>
               </motion.div>
            </motion.div>
          </motion.div>

          <motion.div className="relative">
             <motion.div className="absolute inset-0 bg-[var(--brand-primary)] opacity-[0.05] blur-[120px] rounded-full" />
             <motion.div className="relative space-y-6">
                <HarborCard 
                  name="frontend-harbor" 
                  capabilities={['msg:publish', 'file:claim']} 
                  delay={0.1}
                />
                <motion.div className="flex justify-center">
                   <motion.div className="h-12 w-[2px] bg-gradient-to-b from-[var(--brand-primary)] to-transparent opacity-20" />
                </motion.div>
                <HarborCard 
                  name="system-architect" 
                  capabilities={['code:read', 'notes:write', 'tunnel:create']} 
                  delay={0.2}
                />
             </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
