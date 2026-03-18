import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { History, Activity, Zap, Search, Database, AlertTriangle } from 'lucide-react'

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Time-Travel Debugging"
      description="When multiple agents work on the same project, the hardest question is always 'what happened first?' Learn to use Port Daddy's immutable activity log to reconstruct exactly what happened, in what order, and why."
      number={6}
      total={16}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'P2P Tunnels', href: '/tutorials/tunnel' }}
      next={{ title: 'Reactive Pipelines', href: '/tutorials/pipelines' }}
    >
      <motion.div className="space-y-16">
        {/* Why This Matters */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <History className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Why Timing Matters in Multi-Agent Systems</motion.h2>
          </motion.div>
          <motion.p>
            In a single-agent system, debugging is linear. You read the agent's output from top to bottom and follow the sequence of events. In a multi-agent system, events from different agents are interleaved. Agent A claims a file at 12:04:01, Agent B publishes a message at 12:04:03, Agent A writes a note at 12:04:05, and Agent B claims the same file at 12:04:06. The bug you are chasing is usually hiding in the <em>ordering</em> of these events, not in any single event.
          </motion.p>
          <motion.p>
            Port Daddy solves this by recording every inter-agent event into an append-only, immutable SQLite database. Port claims, file claims, pub/sub messages, session notes, lock acquisitions, and heartbeats all go into the same timeline. You can query this timeline after the fact to reconstruct exactly what happened.
          </motion.p>
          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">Infrastructure</Badge>
                <motion.p className="text-sm font-bold m-0 text-[var(--text-primary)]">Port claims, file claims, lock ops</motion.p>
             </motion.div>
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="amber" className="text-[8px] font-black uppercase tracking-widest">Signals</Badge>
                <motion.p className="text-sm font-bold m-0 text-[var(--text-primary)]">Pub/sub messages, SSE events</motion.p>
             </motion.div>
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest">Agent Context</Badge>
                <motion.p className="text-sm font-bold m-0 text-[var(--text-primary)]">Session notes, heartbeats</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Querying */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Search className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Query the Activity Timeline</motion.h2>
          </motion.div>

          <motion.p>
            The <code>pd activity</code> command is your primary debugging tool. It shows a unified stream of every event the daemon has recorded, sorted by timestamp. Each event includes the type (infra, radio, note), the agent or service that triggered it, and the details.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd activity --limit 20`}
          </CodeBlock>

          <motion.div className="bg-[var(--bg-overlay)] p-10 rounded-[48px] border border-[var(--border-subtle)] font-mono text-xs space-y-2 overflow-hidden shadow-2xl">
             <motion.div className="flex items-center gap-4 text-[var(--text-muted)]">
                <motion.span className="w-24 shrink-0">12:04:01</motion.span>
                <motion.span className="text-[var(--p-teal-400)] w-16 shrink-0">[infra]</motion.span>
                <motion.span>Agent 'planner' claimed port 3102</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4">
                <motion.span className="w-24 shrink-0 text-[var(--text-primary)]">12:04:03</motion.span>
                <motion.span className="text-[var(--p-amber-400)] w-16 shrink-0">[radio]</motion.span>
                <motion.span className="font-bold text-[var(--text-primary)]">swarm:task:new {'->'} {'{id: 42, type: "refactor"}'}</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4 text-[var(--text-muted)]">
                <motion.span className="w-24 shrink-0">12:04:05</motion.span>
                <motion.span className="text-[var(--p-blue-400)] w-16 shrink-0">[note]</motion.span>
                <motion.span>'planner': Started task decomposition</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4 text-[var(--text-muted)]">
                <motion.span className="w-24 shrink-0">12:04:06</motion.span>
                <motion.span className="text-[var(--p-teal-400)] w-16 shrink-0">[infra]</motion.span>
                <motion.span>'coder' claimed files: src/auth/login.ts</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4 text-[var(--text-muted)]">
                <motion.span className="w-24 shrink-0">12:04:12</motion.span>
                <motion.span className="text-[var(--p-amber-400)] w-16 shrink-0">[radio]</motion.span>
                <motion.span>'planner' {'->'} swarm:task:assigned {'{agent: "coder"}'}</motion.span>
             </motion.div>
          </motion.div>

          <motion.p>
            You can also filter by time range to zoom in on a specific incident:
          </motion.p>

          <CodeBlock language="bash">
            {`# Show everything that happened in the last 30 minutes
$ pd activity --since 30m

# Show events between two timestamps
$ pd activity --after "2026-03-17T12:00:00" --before "2026-03-17T12:10:00"`}
          </CodeBlock>
        </section>

        {/* Step 2: Diagnosing Issues */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-purple-400)]">
              <Activity className="text-[var(--p-purple-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Diagnose Common Problems</motion.h2>
          </motion.div>

          <motion.p>
            The activity timeline is most useful for three types of problems: <strong>race conditions</strong>, <strong>lost work</strong>, and <strong>mysterious failures</strong>.
          </motion.p>

          <motion.div className="space-y-8">
            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-xl">Race conditions between agents</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If two agents modified the same file and the result is broken, check the timeline for overlapping file claims. You will see one agent claim the file, then the second agent claim it too (possibly with a conflict warning that was ignored). The timestamps tell you exactly who wrote last.
              </motion.p>
              <CodeBlock language="bash">
                {`# Find all file claim events
$ pd activity --limit 100 | grep "claimed files"`}
              </CodeBlock>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-xl">Lost work after a crash</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If an agent crashed and you are not sure how far it got, check its session notes. Notes are immutable, so even if the agent is dead, its notes survive. Look for the last <code>[milestone]</code> or <code>[progress]</code> note to see what it completed.
              </motion.p>
              <CodeBlock language="bash">
                {`# See notes from a specific session
$ pd notes --session <session-id>

# Or check the salvage queue for the dead agent's context
$ pd salvage`}
              </CodeBlock>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-xl">A service that silently stopped responding</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If an agent's dev server stopped working, check whether its port claim is still active and whether its heartbeats continued. A gap in heartbeats usually means the agent's process died but nobody noticed.
              </motion.p>
              <CodeBlock language="bash">
                {`# Check if the service still has an active port claim
$ pd services

# Check agent heartbeat status
$ pd agent list`}
              </CodeBlock>
            </motion.div>
          </motion.div>
        </section>

        {/* Step 3: Best Practices */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <AlertTriangle className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">3. Best Practices for Debuggable Agent Systems</motion.h2>
          </motion.div>

          <motion.p>
            The quality of your debugging depends on the quality of the data your agents produce. Here are patterns that make time-travel debugging effective:
          </motion.p>

          <motion.div className="space-y-4">
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Write notes at decision points, not just completion</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                A note that says "Decided to use JWT instead of sessions because X" is infinitely more useful than "Auth done." When something goes wrong, decision notes explain <em>why</em> the agent made the choice it made.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Use note types consistently</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                Mark milestones as <code>--type milestone</code>, warnings as <code>--type warning</code>, and decisions as <code>--type decision</code>. This lets you filter the timeline quickly when you are looking for a specific kind of event.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Name your pub/sub channels semantically</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                Use <code>myapp:auth:ready</code> instead of <code>done</code>. When you are reading the timeline, semantic channel names make it immediately clear what each message represents without having to look at the payload.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Keep the daemon running persistently</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                Install Port Daddy as a launchd service (<code>pd install</code>) so it survives reboots. The activity log is only useful if the daemon was running when the events happened. Gaps in the timeline mean gaps in your ability to debug.
              </motion.p>
            </motion.div>
          </motion.div>
        </section>

        {/* Immutable State Note */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-blue-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Database size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Design Principle</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Immutable by Design</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             The activity log and session notes are append-only. Agents cannot delete or edit historical events. This is intentional: when something goes wrong, you need a ground-truth record that no agent has tampered with. The timeline is a ledger, not a scratchpad.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-blue-400)]">
              <Zap size={14} className="animate-pulse" />
              SQLite WAL-Mode Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
