import { Badge } from '@/components/ui/Badge'
import { Anchor, Zap, RefreshCw, Cpu, Shield } from 'lucide-react'

interface Step {
  number: string
  title: string
  description: string
  code: string[]
  icon: typeof Anchor
}

const STEPS: Step[] = [
  {
    number: '01',
    title: 'Atomic Identity',
    description:
      'Summon a session. Port Daddy assigns a stable port and cryptographic identity, checking for orphaned work from previous swarms.',
    code: [
      '$ pd begin --identity swarm:analyst',
      '[pd] Handshake complete · agent-7f3a',
      '  Port 3102 assigned (deterministic)',
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
      '$ pd files claim src/models/*.py',
      '  Claimed · 0 conflicts',
      '',
      '$ pd pub swarm:events "model-ready"',
      '  Published to 12 subscribers',
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
      '$ pd done --note "Model training complete"',
      '  Resources released',
      '  Note pinned to harbor history',
    ],
    color: 'var(--brand-primary)',
    icon: RefreshCw
  },
]

export function HowItWorks() {
  return (
    <motion.section
      id="how-it-works"
      className="py-20 px-6 sm:px-8 lg:px-10 font-sans relative flex flex-col items-center text-center"
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
          <Badge variant="teal" className="mb-10 px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">The Lifecycle</Badge>
          <motion.h2 className="text-4xl sm:text-6xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
            One daemon. <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Infinite Swarms.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed font-sans" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy manages the low-level coordination so your agents can focus on the logic.
            From initial handshake to crash recovery, it is the bedrock of your autonomous team.
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
                   {/* Icon in inset circle */}
                   <motion.div
                     className="w-24 h-24 rounded-[40px] flex items-center justify-center transition-all duration-500 group-hover:scale-110"
                     style={{
                       background: 'var(--surface-base)',
                       boxShadow: 'var(--shadow-inset)',
                     }}
                   >
                     <step.icon size={48} style={{ color: 'var(--brand-accent)' }} />
                   </motion.div>
                   {/* Step number */}
                   <motion.span className="text-7xl font-display font-black opacity-10 group-hover:opacity-20 transition-opacity" style={{ color: 'var(--text-primary)' }}>
                     {step.number}
                   </motion.span>
                </div>

                {/* Description */}
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {step.description}
                </p>

                {/* Code snippet in inset terminal */}
                <motion.div
                  className="w-full p-10 rounded-[56px] font-mono text-sm leading-relaxed relative overflow-hidden transition-all text-left"
                  style={{
                    background: 'var(--code-bg)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                   <div className="absolute top-0 right-0 p-6 opacity-10">
                      <Terminal size={20} style={{ color: 'var(--text-muted)' }} />
                   </div>
                   {step.code.map((line, j) => (
                     <div key={j} style={line.startsWith('$') ? { color: 'var(--code-prompt)', fontWeight: 'bold', marginBottom: '0.5rem' } : { color: 'var(--code-text)' }}>
                       {line}
                     </div>
                   ))}
                </motion.div>
              </div>

              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-12 -right-8 z-20 opacity-20 group-hover:opacity-40 transition-opacity">
                   <ArrowRight size={32} style={{ color: 'var(--text-muted)' }} />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Self-Healing / Always-On Highlight */}
        <motion.div
          className="p-16 sm:p-20 rounded-[100px] relative overflow-hidden flex flex-col items-center gap-12 w-full text-center"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="flex-1 space-y-8 relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Resilience</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span style={{ color: 'var(--brand-primary)' }}>Self-Healing</span> <br /> Swarm.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed max-w-xl" style={{ color: 'var(--text-secondary)' }}>
                Port Daddy doesn't just manage ports—it manages <strong>resilience</strong>. If a critical background agent dies, its state, file claims, and notes are held in an escrow harbor until a replacement is spawned to take its place.
              </motion.p>
              <div className="flex flex-col sm:flex-row items-center gap-6 pt-6">
                 <div className="flex -space-x-6">
                    {[1,2,3].map(i => (
                      <motion.div
                        key={i}
                        className="w-16 h-16 rounded-full flex items-center justify-center"
                        style={{
                          background: 'var(--surface-base)',
                          boxShadow: 'var(--shadow-inset)',
                        }}
                        whileHover={{ y: -8, zIndex: 10 }}
                      >
                         <Cpu size={28} style={{ color: 'var(--brand-primary)' }} />
                      </motion.div>
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
              <motion.div
                className="relative p-12 rounded-[64px] space-y-10"
                style={{
                  background: 'var(--surface-sunken)',
                  boxShadow: 'var(--shadow-inset)',
                }}
              >
                 <div className="flex items-center justify-between">
                    <motion.span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: 'var(--text-muted)' }}>Resurrection Queue</motion.span>
                    <Badge variant="teal" className="px-3 py-1">Escrow Active</Badge>
                 </div>
                 <div className="space-y-6">
                    <motion.div
                      className="p-6 rounded-[32px] flex items-center justify-between"
                      style={{
                        background: 'var(--surface-raised)',
                        boxShadow: 'var(--shadow-sm)',
                      }}
                      whileHover={{ scale: 1.02 }}
                    >
                       <div className="flex items-center gap-5">
                          <RefreshCw size={24} className="animate-spin-slow" style={{ color: 'var(--brand-primary)' }} />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Refactor-Agent</motion.span>
                             <motion.span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>State Preserved</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>2m ago</motion.span>
                    </motion.div>
                    <motion.div
                      className="p-6 rounded-[32px] opacity-40 flex items-center justify-between"
                      style={{
                        background: 'var(--surface-raised)',
                        boxShadow: 'var(--shadow-flat)',
                      }}
                    >
                       <div className="flex items-center gap-5">
                          <Shield size={24} style={{ color: 'var(--text-muted)' }} />
                          <div className="flex flex-col">
                             <motion.span className="text-base font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>Harbor Scopes</motion.span>
                             <motion.span className="text-[10px] uppercase font-bold" style={{ color: 'var(--text-muted)' }}>Tokens Locked</motion.span>
                          </div>
                       </div>
                       <motion.span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-muted)' }}>Active</motion.span>
                    </motion.div>
                 </div>
              </motion.div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
