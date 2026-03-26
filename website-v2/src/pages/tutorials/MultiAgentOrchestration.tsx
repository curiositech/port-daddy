import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Share2, FileCode, MessageSquare, Activity, Users, AlertTriangle } from 'lucide-react'

export function MultiAgentOrchestration() {
  return (
    <TutorialLayout
      title="The Swarm Handshake"
      description="Coordination is more than just avoiding conflicts. Learn to use file claims, session notes, and pub/sub messaging to build agent teams that work together instead of stepping on each other."
      number={2}
      total={16}
      level="Intermediate"
      readTime="12 min read"
      prev={{ title: 'The First Handshake', href: '/tutorials/getting-started' }}
      next={{ title: 'Cryptographic Harbors', href: '/tutorials/harbors' }}
    >
      <motion.div className="space-y-16">
        {/* Why This Matters */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Users className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Why Multi-Agent Coordination Matters</motion.h2>
          </motion.div>
          <motion.p>
            A single AI agent working on a project is straightforward -- it has exclusive access to everything and cannot conflict with anyone. The moment you add a second agent, you introduce a class of problems that every distributed system faces: who owns what, how do you communicate state changes, and what happens when things go wrong.
          </motion.p>
          <motion.p>
            Port Daddy does not try to be a high-level orchestration framework like CrewAI or LangGraph. Instead, it provides the <strong>low-level primitives</strong> that those frameworks (and your own scripts) need to coordinate safely: file claims for ownership, pub/sub channels for communication, and session notes for audit trails. Think of it as the coordination kernel that sits underneath whatever agent framework you are using.
          </motion.p>
          <motion.div
            className="p-10 rounded-2xl space-y-6"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
             <motion.div className="flex items-center justify-between">
                <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Live Example: Two Agents on One Project</motion.span>
                <Badge variant="teal">Active Coordination</Badge>
             </motion.div>
             <motion.div className="space-y-4">
                <motion.div
                  className="flex items-center gap-4 p-4 rounded-2xl"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <motion.div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)] pulse-active" />
                   <motion.span className="text-sm font-bold text-[var(--text-primary)]">Agent 'alpha' claiming src/auth/</motion.span>
                </motion.div>
                <motion.div
                  className="flex items-center gap-4 p-4 rounded-2xl opacity-40"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <motion.div className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
                   <motion.span className="text-sm font-bold text-[var(--text-secondary)]">Agent 'beta' watching for auth-ready signal...</motion.span>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: File Claims */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <FileCode className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Announce Intent with File Claims</motion.h2>
          </motion.div>

          <motion.p>
            Before an agent modifies a file, it should <strong>claim</strong> it. A file claim is an advisory announcement -- it tells the daemon "I am planning to work on these files." It does not hard-lock the file (which would break git workflows and make agents too rigid), but it gives the daemon enough information to warn other agents about potential conflicts.
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent A starts a session and claims files
$ pd begin --identity my-swarm:refactor --purpose "Refactor middleware"
$ pd files claim src/middleware/*.ts src/routes/auth.ts

Claimed 12 files.
No conflicts with other active agents.`}
          </CodeBlock>

          <blockquote
            className="p-8 rounded-2xl border-l-4 border-[var(--p-amber-400)]"
            style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
          >
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               If another agent attempts to claim the same path, Port Daddy will return a <code>CONFLICT</code> error along with the ID of the agent currently holding the claim.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Pub/Sub */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <MessageSquare className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Signal State Changes with Pub/Sub</motion.h2>
          </motion.div>

          <motion.p>
            File claims handle <em>ownership</em>. Pub/sub handles <em>communication</em>. When Agent A finishes its work, it needs a way to tell Agent B "I'm done, you can start using the files I changed." Port Daddy's pub/sub channels provide exactly this.
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent A finishes and signals
$ pd pub swarm:events "auth-middleware-updated"

# Agent B was waiting for this
$ pd watch swarm:events --exec "npm test"

  Watching swarm:events...
  Message received: "auth-middleware-updated"
  Running: npm test
  Tests passed (14/14)`}
          </CodeBlock>

          <motion.p>
            The <code>pd watch</code> command is what makes this powerful. It subscribes to a channel via Server-Sent Events and runs a command every time a message arrives. This is the building block for reactive pipelines: Agent A builds the API, publishes a message, and Agent B automatically runs the test suite in response. No polling, no cron jobs, no manual handoffs.
          </motion.p>

          <motion.div className="grid sm:grid-cols-2 gap-6">
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <Badge variant="neutral">The Broadcaster</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Publishes high-level events like "task_complete" or "error_detected".</motion.p>
             </motion.div>
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <Badge variant="teal">The Listener</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Reacts instantly to events, triggering the next step in the pipeline.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Coordination Pattern */}
        <motion.div
          className="p-16 rounded-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Share2 size={400} />
           </motion.div>
           <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">The Pattern</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Claim, Work, Signal, Done.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             The coordination pattern is always the same. Start a session (<code>pd begin</code>). Claim your files. Do the work, writing notes along the way. Signal completion via pub/sub. End the session (<code>pd done</code>). Every agent follows this lifecycle, and Port Daddy handles the rest.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Activity size={14} className="animate-pulse" />
              Real-time Coordination Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
