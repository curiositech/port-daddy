import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { History, Activity, Zap, Search, Database } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Activity Log Inspection"
      description="When multiple agents work on the same project, the hardest question is 'what happened first?' Learn to use Port Daddy's immutable activity log to reconstruct the sequence of events."
      number="06"
      total={14}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <History className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Why Event Ordering Matters</motion.h2>
          </motion.div>
          <motion.p>
            In a multi-agent system, events from different agents are interleaved. Agent A claims a file at 12:04:01, Agent B publishes a message at 12:04:03, then Agent A writes a note at 12:04:05. Bugs hide in the ordering of these events, not in any single event.
          </motion.p>
          <motion.p>
            Port Daddy records every inter-agent event into an append-only SQLite database. Port claims, file claims, pub/sub messages, session notes, lock acquisitions, and heartbeats all go into the same timeline.
          </motion.p>
          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">Infra</Badge>
                <motion.p className="text-xs font-bold m-0">Port Claims</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="gold" className="text-[8px] font-black uppercase tracking-widest">Signals</Badge>
                <motion.p className="text-xs font-bold m-0">Pub/sub messages, SSE events</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="default" className="text-[8px] font-black uppercase tracking-widest">Cognition</Badge>
                <motion.p className="text-xs font-bold m-0">Agent Notes</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Querying */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Search className="text-[var(--brand-primary)]" size={24} />
            </Surface>
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

          <motion.div
            className="p-10 rounded-2xl font-mono text-xs space-y-2 overflow-hidden"
            style={{ background: 'var(--code-bg)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-lg)' }}
          >
             <motion.div className="flex items-center gap-4 opacity-40">
                <motion.span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:01</motion.span>
                <motion.span className="text-[var(--brand-secondary)]">[infra]</motion.span>
                <motion.span style={{ color: 'var(--code-text)' }}>Agent 'planner' claimed port 3102</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4">
                <motion.span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:05</motion.span>
                <motion.span className="text-[var(--brand-accent)]">[radio]</motion.span>
                <motion.span className="font-bold" style={{ color: 'var(--code-text)' }}>swarm:task:new {'->'} {"{id: 42}"}</motion.span>
             </motion.div>
             <motion.div className="flex items-center gap-4 opacity-40">
                <motion.span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:12</motion.span>
                <motion.span className="text-[var(--brand-secondary)]">[note]</motion.span>
                <motion.span style={{ color: 'var(--code-text)' }}>'planner': Started decomposition</motion.span>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 2: Diagnosing */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Activity className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Diagnose Common Problems</motion.h2>
          </motion.div>

          <motion.p>
            The activity log is most useful for diagnosing race conditions between agents, finding lost work after crashes, and understanding why a service stopped responding.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-10 border-l-8 border-[var(--status-error)]">
             <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-4 text-2xl font-display">Post-Mortem Integrity:</motion.p>
             <motion.p className="m-0 text-lg">
               Since the database is immutable, agents can't "delete their mistakes" to hide errors. This ensures a 100% audit trail for your autonomous organization.
             </motion.p>
          </Surface>
        </section>

        {/* Formal Verification Note */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Database size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Design Principle</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Append-Only Log</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             The timeline isn't just a log--it's a <strong>ledger</strong>. It provides the historical evidence needed to train agents on "coordination failures," allowing your swarms to learn from their own race conditions over time.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
              <Zap size={14} className="animate-pulse" />
              SQLite WAL-Mode Active
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
