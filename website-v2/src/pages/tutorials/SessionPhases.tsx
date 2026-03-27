import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Activity, Zap, Shield, Layers, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function SessionPhases() {
  return (
    <TutorialLayout
      title="The Session State Machine"
      description="Coordination is a sequence of handoffs. Learn to drive agents through planning -> coding -> reviewing phases with auto-escrow and phase-aware salvage."
      number={13}
      total={16}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: 'Sugar Commands', href: '/tutorials/sugar' }}
      next={{ title: 'Debugging', href: '/tutorials/debugging' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <RefreshCw className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Beyond Flat Logs</motion.h2>
          </motion.div>
          <motion.p>
            In a multi-agent swarm, "success" isn't a binary state. Work evolves through a lifecycle. <strong>Session Phases</strong> turn your agent's work into a manageable state machine, allowing the daemon to coordinate complex handoffs between specialists.
          </motion.p>
          <Surface depth="raised" radius="2xl" className="p-10 space-y-8 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-secondary)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Swarm Progress</motion.p>

             <motion.div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <motion.div className="flex flex-col items-center gap-3">
                   <motion.div
                     className="w-10 h-10 rounded-full flex items-center justify-center"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                   >
                      <CheckCircle2 size={18} className="text-[var(--brand-secondary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Planning</motion.span>
                </motion.div>
                <motion.div className="h-[1px] flex-1 opacity-20" style={{ background: 'var(--brand-accent)' }} />
                <motion.div className="flex flex-col items-center gap-3">
                   <motion.div
                     className="w-12 h-12 rounded-full flex items-center justify-center"
                     style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-raised)' }}
                   >
                      <Activity size={20} className="text-[var(--text-inverse)] animate-pulse" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Coding</motion.span>
                </motion.div>
                <motion.div className="h-[1px] flex-1 opacity-20" style={{ background: 'var(--brand-accent)' }} />
                <motion.div className="flex flex-col items-center gap-3 opacity-20">
                   <Surface depth="inset" radius="full" padding="none" className="w-10 h-10 flex items-center justify-center">
                      <Shield size={18} />
                   </Surface>
                   <motion.span className="text-[10px] font-black uppercase tracking-widest">Reviewing</motion.span>
                </motion.div>
             </motion.div>
          </Surface>
        </section>

        {/* Step 1: Transitions */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Transition the Session</motion.h2>
          </motion.div>

          <motion.p>
            Agents should signal their current phase to the daemon. This allows other agents in the harbor to wait for specific state transitions before beginning their own sub-tasks.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd session phase coding\n\n✓ Session phase updated: planning -> coding\n✓ Broadcasted signal to 12 swarm radio subscribers.`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Phase transitions are recorded in the <strong>Immutable Timeline</strong>, providing a high-fidelity audit trail of the work lifecycle.
            </p>
          </Surface>
        </section>

        {/* Step 2: Phase-Aware Salvage */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Layers className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Smart Recovery</motion.h2>
          </motion.div>

          <motion.p>
            If an agent crashes during the <code>coding</code> phase, the next agent to take over (via <code>pd salvage</code>) knows exactly where to resume--checking for half-written files and uncommitted diffs.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd salvage agent-7f3a\n\n✓ Preserved state found.\n✓ Phase: 'coding' detected.\n✓ Instruction: Checking local diffs before resuming...`}
          </CodeBlock>

          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Zero Context Loss</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Agents inherit the previous agent's notes, file claims, and current phase status.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Shield size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">State Integrity</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">The daemon ensures only one agent can "own" a specific phase at a time.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Orchestration Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent Handoffs.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             Session phases turn multi-agent coordination from a series of lucky accidents into a <strong>reliable state machine</strong>. Your swarms converge on a result by methodically completing their assigned lifecycle.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Anchor Protocol v4 Active
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
