import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Activity, Zap, Terminal, Shield, Globe, Share2, Layers, RefreshCw, CheckCircle2 } from 'lucide-react'

export function SessionPhases() {
  return (
    <TutorialLayout
      title="The Session State Machine"
      description="Coordination is a sequence of handoffs. Learn to drive agents through planning → coding → reviewing phases with auto-escrow and phase-aware salvage."
      number="13"
      total="16"
      level="Advanced"
      readTime="15 min read"
      prev={{ title: 'Sugar Commands', href: '/tutorials/sugar' }}
      next={{ title: 'Remote Harbors (Preview)', href: '/tutorials/remote-harbors' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <RefreshCw className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">Beyond Flat Logs</h2>
          </div>
          <p>
            In a multi-agent swarm, "success" isn't a binary state. Work evolves through a lifecycle. **Session Phases** turn your agent's work into a manageable state machine, allowing the daemon to coordinate complex handoffs between specialists.
          </p>
          <div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-r from-[var(--p-teal-500)]/5 to-transparent" />
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Swarm Progress</p>
             
             <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex flex-col items-center gap-3">
                   <div className="w-10 h-10 rounded-full bg-[var(--p-teal-500)]/20 flex items-center justify-center border border-[var(--p-teal-500)]/40">
                      <CheckCircle2 size={18} className="text-[var(--p-teal-400)]" />
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Planning</span>
                </div>
                <div className="h-[1px] flex-1 bg-[var(--border-strong)] opacity-20" />
                <div className="flex flex-col items-center gap-3">
                   <div className="w-12 h-12 rounded-full bg-[var(--brand-primary)]/20 flex items-center justify-center border-2 border-[var(--brand-primary)] shadow-[0_0_12px_rgba(58,173,173,0.3)]">
                      <Activity size={20} className="text-[var(--brand-primary)] animate-pulse" />
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">Coding</span>
                </div>
                <div className="h-[1px] flex-1 bg-[var(--border-strong)] opacity-20" />
                <div className="flex flex-col items-center gap-3 opacity-20">
                   <div className="w-10 h-10 rounded-full bg-[var(--bg-overlay)] flex items-center justify-center border border-[var(--border-subtle)]">
                      <Shield size={18} />
                   </div>
                   <span className="text-[10px] font-black uppercase tracking-widest">Reviewing</span>
                </div>
             </div>
          </div>
        </section>

        {/* Step 1: Transitions */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <Zap className="text-[var(--p-amber-400)]" size={24} />
            </div>
            <h2 className="m-0">1. Transition the Session</h2>
          </div>
          
          <p>
            Agents should signal their current phase to the daemon. This allows other agents in the harbor to wait for specific state transitions before beginning their own sub-tasks.
          </p>

          <CodeBlock language="bash">
            {`$ pd session phase coding\n\n✓ Session phase updated: planning -> coding\n✓ Broadcasted signal to 12 swarm radio subscribers.`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-amber-400)]">
             <p className="m-0 text-sm italic opacity-60 font-medium">
               Phase transitions are recorded in the **Immutable Timeline**, providing a high-fidelity audit trail of the work lifecycle.
             </p>
          </blockquote>
        </section>

        {/* Step 2: Phase-Aware Salvage */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Layers className="text-[var(--p-blue-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Smart Recovery</h2>
          </div>

          <p>
            If an agent crashes during the <code>coding</code> phase, the next agent to take over (via <code>pd salvage</code>) knows exactly where to resume—checking for half-written files and uncommitted diffs.
          </p>

          <CodeBlock language="bash">
            {`$ pd salvage agent-7f3a\n\n✓ Preserved state found.\n✓ Phase: 'coding' detected.\n✓ Instruction: Checking local diffs before resuming...`}
          </CodeBlock>

          <div className="grid sm:grid-cols-2 gap-8 pt-4">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--p-teal-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Zero Context Loss</h3>
                <p className="text-sm opacity-60 m-0">Agents inherit the previous agent's notes, file claims, and current phase status.</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-blue-500)]/10 flex items-center justify-center">
                   <Shield size={20} className="text-[var(--p-blue-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">State Integrity</h3>
                <p className="text-sm opacity-60 m-0">The daemon ensures only one agent can "own" a specific phase at a time.</p>
             </div>
          </div>
        </section>

        {/* Vision Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Orchestration Maturity</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent Handoffs.</h3>
           <p className="text-xl max-w-xl opacity-70">
             Session phases turn multi-agent coordination from a series of lucky accidents into a **reliable state machine**. Your swarms converge on a result by methodically completing their assigned lifecycle.
           </p>
           <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Anchor Protocol v4 Active
           </div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
