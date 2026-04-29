import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { History, Activity, Search } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Activity Log Inspection"
      description="When multiple agents work on the same project, the hardest question is 'what happened first?' Learn to use Port Daddy's immutable activity log to reconstruct the sequence of events."
      number={14}
      total={19}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Cryptographic Harbors', href: '/tutorials/harbors' }}
      next={{ title: 'Reactive Pipelines', href: '/tutorials/pipelines' }}
    >
      <div className="space-y-12">
        {/* Concept Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <History className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Why Event Ordering Matters</h2>
          </div>
          <p>
            In a multi-agent system, events from different agents are interleaved. Agent A claims a file at 12:04:01, Agent B publishes a message at 12:04:03, then Agent A writes a note at 12:04:05. Bugs hide in the ordering of these events, not in any single event.
          </p>
          <p>
            Port Daddy records every inter-agent event into an append-only SQLite database. Port claims, file claims, pub/sub messages, session notes, lock acquisitions, and heartbeats all go into the same timeline.
          </p>
          <div className="flex gap-4 pt-2">
             <Badge variant="teal">Port Claims</Badge>
             <Badge variant="gold">Pub/sub + SSE</Badge>
             <Badge variant="default">Agent Notes</Badge>
          </div>
        </section>

        {/* Step 1: Querying */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Search className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Query the Activity Log</h2>
          </div>

          <p>
            The <code>pd log</code> command shows recent activity. You can also query the REST API directly for more control.
          </p>

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

          <div
            className="p-5 font-mono text-xs space-y-2 overflow-hidden"
            style={{ background: 'var(--code-bg)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-lg)' }}
          >
             <div className="flex items-center gap-4 opacity-40">
                <span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:01</span>
                <span className="text-[var(--brand-secondary)]">[infra]</span>
                <span style={{ color: 'var(--code-text)' }}>Agent 'planner' claimed port 3102</span>
             </div>
             <div className="flex items-center gap-4">
                <span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:05</span>
                <span className="text-[var(--brand-accent)]">[radio]</span>
                <span className="font-bold" style={{ color: 'var(--code-text)' }}>swarm:task:new {'->'} {"{id: 42}"}</span>
             </div>
             <div className="flex items-center gap-4 opacity-40">
                <span className="w-20" style={{ color: 'var(--code-text)' }}>12:04:12</span>
                <span className="text-[var(--brand-secondary)]">[note]</span>
                <span style={{ color: 'var(--code-text)' }}>'planner': Started decomposition</span>
             </div>
          </div>
        </section>

        {/* Step 2: Diagnosing */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Activity className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Diagnose Common Problems</h2>
          </div>

          <p>
            The activity log is most useful for diagnosing race conditions between agents, finding lost work after crashes, and understanding why a service stopped responding.
          </p>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            <strong>Post-Mortem Integrity:</strong> Since the database is immutable, agents can't "delete their mistakes" to hide errors. This ensures a 100% audit trail for your autonomous organization.
          </p>
        </section>

        {/* Design Principle Callout */}
        <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-4 relative overflow-hidden">
           <Badge variant="teal" className="px-4 py-1 text-[10px] font-black uppercase tracking-widest">Design Principle</Badge>
           <p className="text-lg font-bold m-0" style={{ color: 'var(--text-primary)' }}>Append-Only Log</p>
           <p className="max-w-xl mx-auto opacity-70 m-0">
             The timeline isn't just a log--it's a <strong>ledger</strong>. It provides the historical evidence needed to train agents on "coordination failures," allowing your swarms to learn from their own race conditions over time.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
