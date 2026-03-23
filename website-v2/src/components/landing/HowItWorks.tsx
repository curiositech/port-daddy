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
<<<<<<< HEAD
      'Summon a session. Port Daddy assigns a stable port and cryptographic identity, checking for orphaned work from previous swarms.',
    code: [
      '$ pd begin --identity swarm:analyst',
      '[pd] Handshake complete · agent-7f3a',
=======
      'Start a session. Port Daddy assigns a stable port via deterministic hashing, then checks for orphaned work from previous agents.',
    code: [
      '$ pd begin --identity swarm:analyst',
      '',
      '[pd] Session started · agent-7f3a',
>>>>>>> worktree-agent-ae9460d3
      '  Port 3102 assigned (deterministic)',
      '  Salvage: No dead agents detected',
    ],
    icon: Anchor,
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
    icon: Zap,
  },
  {
    number: '03',
    title: 'Self-Healing Done',
    description:
<<<<<<< HEAD
      'When a task finishes, pd done releases resources. If an agent crashes, work is escrowed for Always-On Avatars to salvage.',
=======
      "When a task finishes, pd done releases resources. If an agent crashes, the work is preserved in the salvage queue for another agent to pick up.",
>>>>>>> worktree-agent-ae9460d3
    code: [
      '$ pd done --note "Training complete"',
      '✓ Resources released',
      '✓ Note pinned to harbor history',
    ],
    icon: RefreshCw,
  },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 lg:py-32 bg-[var(--bg-surface)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="teal" className="mb-4">The Lifecycle</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            One daemon. <span className="text-[var(--brand-primary)]">Infinite Swarms.</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Port Daddy manages the low-level coordination so your agents can focus on the logic.
          </p>
        </div>

        {/* Steps */}
        <div className="grid lg:grid-cols-3 gap-8 mb-16">
          {STEPS.map((step, i) => (
            <div key={step.number} className="relative">
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[var(--bg-overlay)] flex items-center justify-center">
                    <step.icon size={24} className="text-[var(--brand-primary)]" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                      Step {step.number}
                    </span>
                    <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                      {step.title}
                    </h3>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[var(--text-secondary)] leading-relaxed">
                  {step.description}
                </p>

                {/* Code Block */}
                <div className="rounded-xl bg-[var(--bg-code)] border border-[var(--border-subtle)] p-4 font-mono text-sm overflow-x-auto">
                  {step.code.map((line, j) => (
                    <div
                      key={j}
                      className={`
                        ${line.startsWith('$') ? 'text-[var(--brand-primary)] font-semibold' : 'text-[var(--text-tertiary)]'}
                        ${line === '' ? 'h-4' : ''}
                      `}
                    >
                      {line}
                    </div>
                  ))}
                </div>
              </div>

              {/* Connector */}
              {i < STEPS.length - 1 && (
                <div className="hidden lg:block absolute top-6 -right-4 w-8 border-t-2 border-dashed border-[var(--border-subtle)]" />
              )}
            </div>
          ))}
        </div>

<<<<<<< HEAD
        {/* Self-Healing Feature */}
        <div className="rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)] p-8 lg:p-12">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <Badge variant="teal">Autonomous Resilience</Badge>
              <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)]">
                The <span className="text-[var(--brand-primary)]">Self-Healing</span> Swarm
              </h3>
              <p className="text-[var(--text-secondary)] leading-relaxed">
                Port Daddy does not just manage ports—it manages <strong>resilience</strong>. If a critical 
                background agent dies, its state, file claims, and notes are held in escrow until a 
                replacement is spawned.
              </p>
              
              {/* Active Agents */}
              <div className="flex items-center gap-4 pt-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-10 h-10 rounded-full bg-[var(--brand-primary)]/10 border-2 border-[var(--bg-base)] flex items-center justify-center"
                    >
                      <Cpu size={16} className="text-[var(--brand-primary)]" />
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-sm font-medium text-[var(--text-primary)]">Active Swarm</div>
                  <div className="text-xs text-[var(--text-tertiary)]">3 Background Avatars</div>
                </div>
=======
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
>>>>>>> worktree-agent-ae9460d3
              </div>
            </div>

            {/* Resurrection Queue Card */}
            <div className="rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-6 shadow-[var(--shadow-md)]">
              <div className="flex items-center justify-between mb-6">
                <span className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
                  Resurrection Queue
                </span>
                <Badge variant="teal" size="sm">Escrow Active</Badge>
              </div>

              <div className="space-y-3">
                {/* Active Item */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20">
                  <RefreshCw size={20} className="text-[var(--brand-primary)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-primary)]">Refactor-Agent</div>
                    <div className="text-xs text-[var(--text-tertiary)]">State Preserved</div>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)]">2m ago</span>
                </div>

                {/* Locked Item */}
                <div className="flex items-center gap-4 p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] opacity-60">
                  <Shield size={20} className="text-[var(--text-muted)]" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[var(--text-secondary)]">Harbor Scopes</div>
                    <div className="text-xs text-[var(--text-tertiary)]">Tokens Locked</div>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)]">Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
