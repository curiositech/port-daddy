import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { History, Activity, Zap, Search, Database } from 'lucide-react'

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Activity Log Inspection"
      description="When multiple agents work on the same project, the hardest question is 'what happened first?' Learn to use Port Daddy's immutable activity log to reconstruct the sequence of events."
      number="06"
      total="14"
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <History className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Why Event Ordering Matters</motion.h2>
          </motion.div>
          <motion.p>
            In a multi-agent system, events from different agents are interleaved. Agent A claims a file at 12:04:01, Agent B publishes a message at 12:04:03, then Agent A writes a note at 12:04:05. Bugs hide in the ordering of these events, not in any single event.
          </motion.p>
          <motion.p>
            Port Daddy records every inter-agent event into an append-only SQLite database. Port claims, file claims, pub/sub messages, session notes, lock acquisitions, and heartbeats all go into the same timeline.
          </motion.p>
          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">Infrastructure</Badge>
                <motion.p className="text-xs font-bold m-0">Port claims, file claims, lock ops</motion.p>
             </motion.div>
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="amber" className="text-[8px] font-black uppercase tracking-widest">Signals</Badge>
                <motion.p className="text-xs font-bold m-0">Pub/sub messages, SSE events</motion.p>
             </motion.div>
             <motion.div className="p-6 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-center space-y-3">
                <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest">Context</Badge>
                <motion.p className="text-xs font-bold m-0">Session notes, heartbeats</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Querying */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Search className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Query the Activity Log</motion.h2>
          </motion.div>

          <motion.p>
            The <code>pd log</code> command shows recent activity. You can also query the REST API directly for more control.
          </motion.p>

          <CodeBlock language="bash">
            {`# View recent activity via CLI
$ pd log

# Query the REST API with a limit
$ curl http://localhost:9876/activity?limit=20

# Get a summary grouped by type
$ curl http://localhost:9876/activity/summary

# Get activity statistics
$ curl http://localhost:9876/activity/stats`}
          </CodeBlock>

          <motion.div className="bg-[var(--bg-overlay)] p-10 rounded-[48px] border border-[var(--border-subtle)] font-mono text-xs space-y-2 overflow-hidden shadow-2xl">
             <motion.div className="flex items-center gap-4 opacity-40">
                <motion.span className="w-20">12:04:01</motion.span>
                <motion.span className="text-[var(--p-teal-400)]">[infra]</motion.span>
                <motion.span>Agent 'planner' claimed port 3102</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4">
                <motion.span className="w-20">12:04:05</motion.span>
                <motion.span className="text-[var(--p-amber-400)]">[radio]</motion.span>
                <motion.span className="font-bold text-[var(--text-primary)]">swarm:task:new {'->'} {"{id: 42}"}</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4 opacity-40">
                <motion.span className="w-20">12:04:12</motion.span>
                <motion.span className="text-[var(--p-blue-400)]">[note]</motion.span>
                <motion.span>'planner': Started decomposition</motion.span>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 2: Diagnosing */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-purple-400)]">
              <Activity className="text-[var(--p-purple-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Diagnose Common Problems</motion.h2>
          </motion.div>

          <motion.p>
            The activity log is most useful for diagnosing race conditions between agents, finding lost work after crashes, and understanding why a service stopped responding.
          </motion.p>

          <motion.div className="space-y-4">
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Check overlapping file claims</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                If two agents modified the same file, the activity log shows who claimed it and when. Look for overlapping timestamps.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Review session notes after a crash</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                Notes are immutable. Even after an agent dies, its notes survive. Use <code>pd notes --session &lt;id&gt;</code> or <code>pd salvage</code> to see what it completed.
              </motion.p>
            </motion.div>
            <motion.div className="p-6 rounded-[24px] bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-2">Check agent heartbeats</motion.p>
              <motion.p className="text-sm m-0 text-[var(--text-secondary)] leading-relaxed">
                A gap in heartbeats means the agent's process died. Use <code>pd services</code> to check active ports and <code>pd agent list</code> for heartbeat status.
              </motion.p>
            </motion.div>
          </motion.div>
        </section>

        {/* Immutable Design Note */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-blue-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Database size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Design Principle</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Append-Only Log</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             The activity log and session notes are append-only. Agents cannot delete or edit historical events. When something goes wrong, you have a ground-truth record that no agent has tampered with.
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
