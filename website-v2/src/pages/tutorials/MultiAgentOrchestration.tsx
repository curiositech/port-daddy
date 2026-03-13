import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Share2, FileCode, MessageSquare, Terminal, Zap, Shield, Activity, Users } from 'lucide-react'

export function MultiAgentOrchestration() {
  return (
    <TutorialLayout
      title="The Swarm Handshake"
      description="Coordination is more than just avoiding conflicts. Learn to use file claims, session notes, and Swarm Radio to build high-fidelity agent teams."
      number="02"
      total="16"
      level="Intermediate"
      readTime="12 min read"
      prev={{ title: 'The First Handshake', href: '/tutorials/getting-started' }}
      next={{ title: 'Cryptographic Harbors', href: '/tutorials/harbors' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Users className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">Beyond the Singleton</h2>
          </div>
          <p>
            Port Daddy is at its most powerful when multiple agents (or a human and an agent) are working on the same project. It provides the low-level **advisory locks** and **signaling channels** needed to keep everyone in sync.
          </p>
          <div className="bg-[var(--bg-surface)] p-10 rounded-[40px] border border-[var(--border-subtle)] space-y-6 shadow-2xl">
             <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest opacity-40">Swarm Status</span>
                <Badge variant="teal">Active Coordination</Badge>
             </div>
             <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--p-teal-500)]/20">
                   <div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)] pulse-active" />
                   <span className="text-sm font-bold">Agent 'alpha' claiming src/auth/</span>
                </div>
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-transparent opacity-40">
                   <div className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
                   <span className="text-sm font-bold">Agent 'beta' waiting for signal...</span>
                </div>
             </div>
          </div>
        </section>

        {/* Step 1: File Claims */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <FileCode className="text-[var(--p-amber-400)]" size={24} />
            </div>
            <h2 className="m-0">1. Announce Intent</h2>
          </div>
          
          <p>
            Before an agent modifies a file, it should <strong>claim</strong> it. This doesn't hard-lock the file (which would break git workflows), but it notifies the daemon so other agents can be warned.
          </p>

          <CodeBlock language="bash">
            {`$ pd begin --identity my-swarm:refactor\n$ pd files claim src/middleware/*.ts\n\n✓ Claimed 12 files.\n✓ No conflicts with other active agents.`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-amber-400)]">
             <p className="m-0 text-sm italic opacity-60 font-medium">
               If another agent attempts to claim the same path, Port Daddy will return a <code>CONFLICT</code> error along with the ID of the agent currently holding the claim.
             </p>
          </blockquote>
        </section>

        {/* Step 2: Swarm Radio */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <MessageSquare className="text-[var(--p-blue-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Signal the Fleet</h2>
          </div>

          <p>
            Use **Swarm Radio** (Pub/Sub) to broadcast state changes. This is pivotal for CrewAI-style handoffs or LangChain tool synchronization.
          </p>

          <CodeBlock language="bash">
            {`# Agent A publishes result\npd pub swarm:events "auth-middleware-updated"\n\n# Agent B is watching\npd watch swarm:events --exec "npm test"`}
          </CodeBlock>

          <div className="grid sm:grid-cols-2 gap-6">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="neutral">The Broadcaster</Badge>
                <p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Publishes high-level events like "task_complete" or "error_detected".</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="teal">The Listener</Badge>
                <p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Reacts instantly to events, triggering the next step in the pipeline.</p>
             </div>
          </div>
        </section>

        {/* Coordination Pattern */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Share2 size={400} />
           </div>
           <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">The "Lighthouse" Pattern</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent State.</h3>
           <p className="text-xl max-w-xl opacity-70">
             By combining file claims with Swarm Radio, you can build agents that self-organize. One agent manages the "truth" (the lighthouse), while others orbit it, claiming sub-tasks and reporting progress in real-time.
           </p>
           <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Activity size={14} className="animate-pulse" />
              Real-time Mesh Active
           </div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
