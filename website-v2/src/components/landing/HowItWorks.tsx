import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { ArrowRight, Terminal, Zap, Shield, RefreshCw, Cpu, Anchor } from 'lucide-react'

interface Step {
  number: string
  title: string
  description: string
  code: string[]
  color: string
  icon: any
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Atomic Identity',
    description:
      'Start a session. Port Daddy assigns a stable port via deterministic hashing, then checks for orphaned work from previous agents.',
    code: [
      '$ pd begin --identity swarm:analyst',
      '',
      '[pd] Session started · agent-7f3a',
      '  Port 3102 assigned (deterministic)',
      '  Salvage: No dead agents detected',
    ],
    color: 'var(--p-teal-400)',
    icon: Anchor
  },
  {
    number: '02',
    title: 'Harbor Coordination',
    description:
      'Claim files, acquire locks, and broadcast events on Swarm Radio. All inter-agent signaling happens through the local daemon.',
    code: [
      '$ pd files claim src/models/*.py',
      '✓ Claimed · 0 conflicts',
      '',
      '$ pd pub swarm:events "model-ready"',
      '✓ Published to 12 subscribers',
    ],
    color: 'var(--p-amber-400)',
    icon: Zap
  },
  {
    number: '03',
    title: 'Self-Healing Done',
    description:
      "When a task finishes, pd done releases resources. If an agent crashes, the work is preserved in the salvage queue for another agent to pick up.",
    code: [
      '$ pd done --note "Model training complete"',
      '✓ Resources released',
      '✓ Note pinned to harbor history',
    ],
    color: 'var(--p-blue-400)',
    icon: RefreshCw
  },
]

export function HowItWorks() {
  return (
    <motion.section 
      id="how-it-works" 
      className="py-20 px-6 sm:px-8 lg:px-10 font-sans relative bg-[var(--bg-base)] flex flex-col items-center text-center"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto font-sans flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-16 flex flex-col items-center gap-8"
        >
          <Badge variant="teal" className="mb-10 px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Lifecycle</Badge>
          <motion.h2 className="text-4xl sm:text-6xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
            One daemon. <br />
            <motion.span className="text-[var(--brand-primary)]">Infinite Swarms.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy manages the low-level coordination so your agents can focus on the logic. 
            From initial handshake to crash recovery, it is the bedrock of your autonomous team.
          </motion.p>
        </motion.div>

        <div className="grid lg:grid-cols-3 gap-8 w-full mb-32">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="relative group flex flex-col items-center text-center"
            >
              <div className="space-y-12 w-full flex flex-col items-center">
                <div className="flex items-center justify-between w-full max-w-[280px]">
                   <motion.div 
                     className="w-24 h-24 rounded-[40px] flex items-center justify-center border transition-all duration-500 group-hover:scale-110 shadow-xl"
                     style={{ background: `${step.color}10`, borderColor: `${step.color}20` }}
                   >
                     <step.icon size={48} style={{ color: step.color }} />
                   </motion.div>
                   <motion.span className="text-7xl font-display font-black opacity-10 group-hover:opacity-20 transition-opacity" style={{ color: step.color }}>
                     {step.number}
                   </motion.span>
                </div>

                <div className="space-y-6 flex flex-col items-center">
                   <motion.h3 className="text-4xl font-display font-black m-0 tracking-tight" style={{ color: 'var(--text-primary)' }}>{step.title}</motion.h3>
                   <motion.p className="text-xl leading-relaxed m-0 transition-opacity max-w-sm" style={{ color: 'var(--text-muted)' }}>
                     {step.description}
                   </motion.p>
                </div>

                <motion.div 
                  className="w-full p-10 rounded-[56px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-sm leading-relaxed relative overflow-hidden group-hover:border-[var(--brand-primary)]/40 transition-all shadow-2xl text-left"
                >
                   <div className="absolute top-0 right-0 p-6 opacity-10">
                      <Terminal size={20} />
                   </div>
                   {step.code.map((line, j) => (
                     <div key={j} className={line.startsWith('$') ? 'text-[var(--brand-primary)] font-bold mb-2' : ''} style={line.startsWith('$') ? {} : { color: 'var(--text-muted)' }}>
                       {line}
                     </div>
                   ))}
                </motion.div>
              </div>
              
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-12 -right-8 z-20 opacity-20 group-hover:opacity-40 transition-opacity">
                   <ArrowRight size={32} />
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Self-Healing / Always-On Highlight */}
        <motion.div 
          className="p-16 sm:p-20 rounded-[100px] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] border border-[var(--border-strong)] relative overflow-hidden flex flex-col items-center gap-12 shadow-2xl w-full text-center"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="flex-1 space-y-8 relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-2xl">Crash Recovery</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                Session <span className="text-[var(--p-teal-400)]">Salvage</span> <br /> Queue.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                When an agent dies, Port Daddy preserves its session notes and file claims in the salvage queue. A new agent can claim the dead agent's context and continue where it left off. No work is lost.
              </motion.p>
              <div className="flex flex-col sm:flex-row items-center gap-6 pt-6">
                 <div className="flex -space-x-6">
                    {[1,2,3].map(i => (
                      <motion.div 
                        key={i} 
                        className="w-16 h-16 rounded-full border-4 border-[var(--bg-surface)] bg-[var(--p-teal-500)]/20 flex items-center justify-center shadow-xl"
                        whileHover={{ y: -8, zIndex: 10 }}
                      >
                         <Cpu size={28} className="text-[var(--p-teal-400)]" />
                      </motion.div>
                    ))}
                 </div>
                 <div className="flex flex-col items-center">
                    <motion.span className="text-sm font-black uppercase tracking-[0.2em] text-[var(--p-teal-400)]">Active Swarm</motion.span>
                    <motion.span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>3 Background Avatars</motion.span>
                 </div>
              </div>
           </div>
           
           <div className="flex-1 w-full relative max-w-md">
              <motion.div className="absolute inset-0 bg-[var(--brand-primary)] opacity-[0.05] blur-[140px] rounded-full" />
              <motion.div className="relative p-12 rounded-[64px] bg-[var(--bg-overlay)] border border-[var(--border-strong)] shadow-2xl space-y-10">
                 <div className="flex items-center justify-between">
                    <motion.span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>Resurrection Queue</motion.span>
                    <Badge variant="teal" className="px-3 py-1 shadow-sm">Escrow Active</Badge>
                 </div>
                 <div className="space-y-6">
                    <motion.div 
                      className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--p-teal-500)]/20 flex items-center justify-between shadow-lg"
                      whileHover={{ scale: 1.02 }}
                    >
                       <div className="flex items-center gap-5">
                          <RefreshCw size={24} className="text-[var(--p-teal-400)] animate-spin-slow" />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Refactor-Agent</motion.span>
                             <motion.span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>State Preserved</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>2m ago</motion.span>
                    </motion.div>
                    <motion.div 
                      className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-transparent opacity-40 flex items-center justify-between"
                    >
                       <div className="flex items-center gap-5">
                          <Shield size={24} />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight">Harbor Scopes</motion.span>
                             <motion.span className="text-[10px] uppercase font-bold">Tokens Locked</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[10px] font-mono font-bold">Active</motion.span>
                    </motion.div>
                 </div>
              </motion.div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
