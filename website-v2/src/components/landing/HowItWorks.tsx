import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Anchor, Zap, RefreshCw, Cpu, Shield, ArrowRight, Terminal } from 'lucide-react'

interface Step {
  number: string
  title: string
  description: string
  code: string[]
  icon: typeof Anchor
  color?: string
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Atomic Identity',
    description:
      'Summon a session. Port Daddy assigns a stable port and semantic identity, checking for orphaned work from previous swarms.',
    code: [
      '$ pd begin "Analyzing data" --identity swarm:analyst',
      '  Agent agent-7f3a ready',
      '  Session started · port 3102 · identity swarm:analyst',
      '  Salvage: No dead agents detected',
    ],
    color: 'var(--brand-primary)',
    icon: Anchor
  },
  {
    number: '02',
    title: 'Harbor Coordination',
    description:
      'Claim files, acquire locks, and broadcast events on Swarm Radio. All inter-agent signaling happens through the local daemon.',
    code: [
      '$ pd session files add src/models/*.py',
      '  Claimed · 0 conflicts',
      '',
      '$ pd pub swarm:events "model-ready"',
      '  Published to swarm:events',
    ],
    color: 'var(--brand-accent)',
    icon: Zap
  },
  {
    number: '03',
    title: 'Self-Healing Done',
    description:
      'When a task finishes, pd done releases resources. If an agent crashes, work is escrowed for Always-On Avatars to salvage.',
    code: [
      '$ pd done "Model training complete"',
      '  Session completed · agent unregistered',
      '  Note pinned to session history',
    ],
    color: 'var(--brand-primary)',
    icon: RefreshCw
  },
]

export function HowItWorks() {
  return (
    <motion.section
      id="how-it-works"
      className="py-16 lg:py-24 px-6 lg:px-8 font-sans relative flex flex-col items-center text-center"
      style={{ background: 'var(--surface-base)' }}
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
          <Badge variant="teal" className="mb-10 px-6 py-2 text-[12px] font-black uppercase tracking-[0.25em]">The Lifecycle</Badge>
          <motion.h2 className="text-3xl sm:text-5xl lg:text-6xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
            One daemon. <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Infinite Swarms.</motion.span>
          </motion.h2>
          <motion.p className="text-xl sm:text-2xl lg:text-3xl max-w-4xl mx-auto leading-relaxed font-sans" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy manages the low-level coordination so your agents can focus on the logic.
            From initial handshake to crash recovery, it's the infrastructure your autonomous team runs on.
          </motion.p>
        </motion.div>

        {/* Steps */}
        <div className="grid lg:grid-cols-3 gap-8 mb-16">
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
                   <Surface depth="inset" radius="none" padding="none" className="w-24 h-24 flex items-center justify-center transition-colors duration-500">
                     <step.icon size={48} style={{ color: 'var(--brand-accent)' }} />
                   </Surface>
                   {/* Step number */}
                   <motion.span className="text-7xl font-display font-black opacity-10 group-hover:opacity-20 transition-opacity" style={{ color: 'var(--text-primary)' }}>
                     {step.number}
                   </motion.span>
                </div>

                {/* Description */}
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {step.description}
                </p>

                <div className="w-full border-2 border-[var(--border-strong)] bg-[var(--code-bg)] px-3 py-3 font-mono text-sm leading-relaxed relative overflow-hidden text-left sm:px-6 sm:py-4">
                   <div className="absolute top-0 right-0 p-6 opacity-10">
                      <Terminal size={20} style={{ color: 'var(--text-muted)' }} />
                   </div>
                   {step.code.map((line, j) => (
                     <div key={j} style={line.startsWith('$') ? { color: 'var(--code-prompt)', fontWeight: 'bold', marginBottom: '0.5rem' } : { color: 'var(--code-text)' }}>
                       {line}
                     </div>
                   ))}
                </div>
              </div>

              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-12 -right-8 z-20 opacity-20 group-hover:opacity-40 transition-opacity">
                   <ArrowRight size={32} style={{ color: 'var(--text-muted)' }} />
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Self-Healing / Always-On Highlight */}
        <Surface depth="raised" radius="4xl" padding="xl" className="relative overflow-hidden flex flex-col items-center gap-12 w-full text-center p-6 sm:p-12 lg:p-16">
           <div className="flex-1 space-y-8 relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-6 py-2 text-[12px] font-black uppercase tracking-widest">Autonomous Resilience</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span style={{ color: 'var(--brand-primary)' }}>Self-Healing</span> <br /> Swarm.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                Port assignment is the easy part. The real work is <strong>resilience</strong>. If a critical background agent dies, its state, file claims, and notes are held in an escrow harbor until a replacement is spawned.
              </motion.p>
              <div className="flex flex-col sm:flex-row items-center gap-6 pt-6">
                 <div className="flex -space-x-6">
                    {[1,2,3].map(i => (
                      <Surface
                        key={i}
                        depth="inset"
                        radius="full"
                        padding="none"
                        className="w-16 h-16 flex items-center justify-center"
                      >
                         <Cpu size={28} style={{ color: 'var(--brand-primary)' }} />
                      </Surface>
                    ))}
                 </div>
                 <div className="flex flex-col items-center">
                    <motion.span className="text-sm font-black uppercase tracking-[0.2em]" style={{ color: 'var(--brand-primary)' }}>Active Swarm</motion.span>
                    <motion.span className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>3 Background Avatars</motion.span>
                 </div>
              </div>
           </div>

           <div className="flex-1 w-full relative max-w-md">
              <motion.div className="absolute inset-0 opacity-[0.05] blur-[140px] rounded-full" style={{ background: 'var(--brand-primary)' }} />
              <Surface depth="inset" radius="4xl" padding="xl" className="relative space-y-10 p-6 sm:p-8 lg:p-12">
                 <div className="flex items-center justify-between">
                    <motion.span className="text-[12px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>Resurrection Queue</motion.span>
                    <Badge variant="teal" className="px-3 py-1">Escrow Active</Badge>
                 </div>
                 <div className="space-y-6">
                    <Surface depth="raised" radius="3xl" padding="lg" className="flex items-center justify-between p-6">
                       <div className="flex items-center gap-5">
                          <RefreshCw size={24} className="animate-spin-slow" style={{ color: 'var(--brand-primary)' }} />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Refactor-Agent</motion.span>
                             <motion.span className="text-[12px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>State Preserved</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[12px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>2m ago</motion.span>
                    </Surface>
                    <motion.div
                      className="p-6 rounded-[var(--radius-3xl)] opacity-40 flex items-center justify-between"
                      style={{
                        background: 'var(--surface-raised)',
                        boxShadow: 'var(--shadow-flat)',
                      }}
                    >
                       <div className="flex items-center gap-5">
                          <Shield size={24} style={{ color: 'var(--text-muted)' }} />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Harbor Scopes</motion.span>
                             <motion.span className="text-[12px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Tokens Locked</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[12px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Active</motion.span>
                    </motion.div>
                 </div>
              </Surface>
           </div>
        </Surface>
      </motion.div>
    </motion.section>
  )
}
