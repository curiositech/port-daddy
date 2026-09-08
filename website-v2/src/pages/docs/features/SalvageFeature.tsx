import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function SalvageFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Salvage
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Agent Salvage
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          When an agent dies mid-task, its work context survives in the salvage queue — this is
          recovery after let-it-crash, not a guarantee of clean resumption. Another agent claims
          the dead agent's sessions, notes, and file claims, then resumes from the last note instead
          of starting cold. In-flight state is not restored; the notes are the handoff.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
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
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Agents register with an identity and send periodic heartbeats — a liveness signal. When
          heartbeats stop, the daemon applies a status-aware timeout ladder — short for a starting
          or draining agent, longer for one mid-task — then marks it dead. Dead agents with active
          sessions enter the salvage queue, where another agent can claim the surviving notes and
          file claims and carry on.
        </p>

        <DocsCodeBlock
          code={`# Agent registers on startup
$ pd agent register --identity myapp:api:auth --purpose "Building JWT refresh"

# Agent sends heartbeats on an interval (automated by SDK)
$ pd agent heartbeat --agent agent-abc123

# Agent dies... heartbeats stop...
# Once it misses heartbeats past the dead threshold, the daemon
# adds it to the salvage queue

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
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Salvage Lifecycle</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The resurrection pipeline moves agents through a series of states, from healthy
          to salvaged. Context is preserved at every step.
        </p>

        <div className="grid sm:grid-cols-4 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">alive</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Heartbeat within 10 min</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">stale</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">No heartbeat for 10 min</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">dead</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">No heartbeat for 20 min</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">salvaged</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Work claimed by new agent</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>
        </div>

        <div className="space-y-3">
          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd agent register --identity &lt;id&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Register an agent with a semantic identity and purpose. Enables heartbeat tracking and salvage eligibility.</p>
            <DocsCodeBlock
              code={`$ pd agent register --identity myapp:api:auth --purpose "Building JWT refresh"`}
              output={`Agent agent-abc123 registered (myapp:api:auth)
WARNING: 2 dead agent(s) in myapp:*. Run: pd salvage --project myapp`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd salvage</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all agents in the resurrection queue. Filter by project or stack for targeted recovery.</p>
            <DocsCodeBlock
              code={`$ pd salvage --project myapp`}
              output={`Salvage queue for myapp:
  agent-abc123  myapp:api:auth     "Building JWT refresh"     dead 12m
  agent-def456  myapp:api:billing  "Stripe webhook handler"   dead 45m`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd salvage claim &lt;agent-id&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Claim a dead agent's work. Transfers sessions, notes, and file claims to the claiming agent.</p>
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
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>
        </div>

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
await pd.note('Resuming JWT refresh work', { sessionId: salvaged.sessionId })`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Activity Timeline</div>
          <div className="text-sm text-[var(--text-muted)]">Full audit trail of all daemon operations</div>
        </div>
        <Link
          to="/docs/features/timeline"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
