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
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
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
          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[40px] border border-[var(--border-subtle)] space-y-6 shadow-2xl">
             <motion.div className="flex items-center justify-between">
                <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Live Example: Two Agents on One Project</motion.span>
                <Badge variant="teal">Active Coordination</Badge>
             </motion.div>
             <motion.div className="space-y-4">
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--p-teal-500)]/20">
                   <motion.div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)] pulse-active" />
                   <motion.span className="text-sm font-bold text-[var(--text-primary)]">Agent 'alpha' claiming src/auth/</motion.span>
                </motion.div>
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-transparent">
                   <motion.div className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
                   <motion.span className="text-sm font-bold text-[var(--text-secondary)]">Agent 'beta' watching for auth-ready signal...</motion.span>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: File Claims */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
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

          <motion.p>
            Now imagine Agent B starts up and tries to claim some of the same files:
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent B tries to work on overlapping files
$ pd begin --identity my-swarm:api --purpose "Add rate limiting"
$ pd files claim src/middleware/rateLimit.ts

WARNING: CONFLICT
  src/middleware/rateLimit.ts is claimed by my-swarm:refactor
  Session: abc123 | Purpose: "Refactor middleware"

  Claim registered anyway (advisory).
  Consider coordinating with my-swarm:refactor.`}
          </CodeBlock>

          <motion.p>
            Notice that Port Daddy still allows Agent B to register its claim -- it is advisory, not blocking. But the warning is valuable: Agent B now knows another agent is working on the same file and can decide whether to wait, work on something else, or coordinate directly via pub/sub.
          </motion.p>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-amber-400)]">
             <motion.p className="m-0 text-base font-medium text-[var(--text-secondary)]">
               <strong className="text-[var(--text-primary)]">Why advisory instead of mandatory?</strong> Hard locks sound safer, but they create deadlocks. If Agent A locks a file and then crashes, the file stays locked until someone manually releases it. Advisory claims plus crash recovery (salvage) give you the coordination benefit without the deadlock risk.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Pub/Sub */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
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
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="neutral">The Publisher</Badge>
                <motion.p className="text-sm m-0 leading-relaxed text-[var(--text-secondary)]">Broadcasts high-level events when it completes a unit of work. Keep messages semantic: "auth-ready" is better than "done" because subscribers can filter by topic.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="teal">The Subscriber</Badge>
                <motion.p className="text-sm m-0 leading-relaxed text-[var(--text-secondary)]">Reacts to events with <code>--exec</code> to trigger the next step. The message content is available as environment variables (<code>PD_MESSAGE</code>, <code>PD_CHANNEL</code>).</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 3: Session Notes */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Activity className="text-[var(--p-teal-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">3. Leave a Trail with Session Notes</motion.h2>
          </motion.div>

          <motion.p>
            File claims and pub/sub handle the mechanics of coordination. Session notes handle the <em>context</em>. As an agent works, it should periodically write notes explaining what it is doing and why. Notes are immutable -- they are appended to the session log and can never be edited or deleted.
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent A documents its decisions
$ pd note "Refactoring auth middleware to use JWT instead of sessions"
$ pd note "Changed token shape — consumers need to update" --type warning
$ pd note "Auth middleware refactor complete, 3 files changed" --type milestone`}
          </CodeBlock>

          <motion.p>
            Why does this matter? Because agents crash. Context windows fill up. Sessions end. When the next agent starts working on the same project, it can read the notes from previous sessions to understand what happened:
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd notes --limit 5

[milestone] Auth middleware refactor complete, 3 files changed    2m ago
[warning]   Changed token shape — consumers need to update        5m ago
[progress]  Refactoring auth middleware to use JWT                 8m ago`}
          </CodeBlock>

          <motion.p>
            This is especially valuable for <strong>salvage</strong>. When an agent dies mid-task and a new agent picks up its work, the notes are the primary source of context about what was completed and what still needs to be done.
          </motion.p>
        </section>

        {/* Common Pitfalls */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <AlertTriangle className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Common Pitfalls</motion.h2>
          </motion.div>

          <motion.div className="space-y-6">
            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Forgetting to run pd begin</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If you skip <code>pd begin</code>, your file claims and notes are not attached to a session. They still work, but they cannot be salvaged if the agent crashes. Always start with <code>pd begin</code>.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Too-broad file claims</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                Claiming <code>src/**/*</code> defeats the purpose. Claim specific directories or files that you actually intend to modify. The narrower the claim, the more useful the conflict warnings.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Using pub/sub for large payloads</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                Pub/sub messages should be small signals: event names, status updates, short JSON. If you need to pass large data between agents, write it to a file and publish the file path as the message.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Not running pd done when finished</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If you skip <code>pd done</code>, your session stays active and your file claims remain registered. The next agent will see stale conflict warnings. Always clean up with <code>pd done</code> when your agent finishes its work.
              </motion.p>
            </motion.div>
          </motion.div>
        </section>

        {/* Putting It All Together */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
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
