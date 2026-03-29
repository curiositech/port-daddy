import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function SalvageFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Resilience</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Agent Salvage
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          When an agent dies mid-task, its work context is preserved in the resurrection queue.
          Another agent can claim the dead agent's sessions, notes, and file claims to continue
          exactly where it left off.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          AI agents are not immortal. They crash, lose connections, exceed context windows, or
          simply time out. Without crash recovery:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>All context about what the agent was doing is lost forever</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>The replacement agent starts from scratch, duplicating work</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>File claims and port assignments are orphaned, blocking other agents</span>
          </li>
        </ul>
      </div>

      {/* How It Works */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Agents register with an identity and send periodic heartbeats. When heartbeats stop,
          the daemon marks the agent as stale (10 min), then dead (20 min). Dead agents with
          active sessions enter the resurrection queue, where another agent can claim their work.
        </p>

        <DocsCodeBlock
          code={`# Agent registers on startup
$ pd agent register --identity myapp:api:auth --purpose "Building JWT refresh"

# Agent sends heartbeats every 5 minutes (automated by SDK)
$ pd agent heartbeat --agent agent-abc123

# Agent dies... heartbeats stop...
# After 20 minutes, the daemon adds it to the salvage queue

# New agent checks the salvage queue
$ pd salvage --project myapp

# New agent claims the dead agent's work
$ pd salvage claim agent-abc123`}
          output={`Agent agent-abc123 registered (myapp:api:auth)
Heartbeat recorded

Salvage queue for myapp:
  agent-abc123  myapp:api:auth  "Building JWT refresh"  dead 12m
    Session s-a1b2c3: 5 notes, 2 file claims

Claimed agent-abc123 — session s-a1b2c3 transferred
  Notes: 5 (read-only)
  Files: src/auth/refresh.ts, src/middleware/jwt.ts`}
        />
      </div>

      {/* Salvage Lifecycle */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Salvage Lifecycle</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The resurrection pipeline moves agents through a series of states, from healthy
          to salvaged. Context is preserved at every step.
        </p>

        <div className="grid sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">alive</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Heartbeat within 10 min</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">stale</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">No heartbeat for 10 min</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">dead</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">No heartbeat for 20 min</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">salvaged</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Work claimed by new agent</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd agent register --identity &lt;id&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Register an agent with a semantic identity and purpose. Enables heartbeat tracking and salvage eligibility.</p>
            <DocsCodeBlock
              code={`$ pd agent register --identity myapp:api:auth --purpose "Building JWT refresh"`}
              output={`Agent agent-abc123 registered (myapp:api:auth)
WARNING: 2 dead agent(s) in myapp:*. Run: pd salvage --project myapp`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd salvage</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all agents in the resurrection queue. Filter by project or stack for targeted recovery.</p>
            <DocsCodeBlock
              code={`$ pd salvage --project myapp`}
              output={`Salvage queue for myapp:
  agent-abc123  myapp:api:auth     "Building JWT refresh"     dead 12m
  agent-def456  myapp:api:billing  "Stripe webhook handler"   dead 45m`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd salvage claim &lt;agent-id&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Claim a dead agent's work. Transfers sessions, notes, and file claims to the claiming agent.</p>
            <DocsCodeBlock
              code={`$ pd salvage claim agent-abc123`}
              output={`Claimed agent-abc123 — session s-a1b2c3 transferred
  Notes: 5 (read-only)
  Files: src/auth/refresh.ts, src/middleware/jwt.ts`}
            />
          </div>
        </div>
      </div>

      {/* SDK Usage */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>

        <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
          <div className="text-sm font-medium text-[var(--text-muted)] mb-3">TypeScript</div>
          <DocsCodeBlock
            language="typescript"
            code={`import { PortDaddy } from 'port-daddy'

const pd = new PortDaddy()

// Check for dead agents in your project
const queue = await pd.salvage.list({ project: 'myapp' })

// Claim a dead agent's work
if (queue.length > 0) {
  const salvaged = await pd.salvage.claim(queue[0].agentId)
  console.log('Inherited notes:', salvaged.notes.length)
  console.log('Inherited files:', salvaged.files)
}

// Continue where the dead agent left off
await pd.sessions.addNote(salvaged.sessionId, 'Resuming JWT refresh work')`}
          />
        </div>
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Activity Timeline</div>
          <div className="text-sm text-[var(--text-muted)]">Full audit trail of all daemon operations</div>
        </div>
        <Link
          to="/docs/features/timeline"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
