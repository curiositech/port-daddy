import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function SessionsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Sessions
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Sessions & Notes
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          A record of what each agent is working on, with a history that can't be rewritten. Every
          session is logged and every note is append-only. File claims announce which files an agent
          intends to touch — they surface likely conflicts early, but they advise rather than lock.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          AI agents work fast, but they leave no trace. When something goes wrong or an agent
          crashes mid-task, the team faces:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No record of what an agent did, changed, or decided</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Lost context when an agent crashes and another takes over</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Two agents editing the same file at the same time without knowing</span>
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
          Sessions track the lifecycle of an agent's work. Notes are immutable, append-only
          records within a session. File claims are advisory locks that warn agents about
          potential edit conflicts.
        </p>

        <DocsCodeBlock
          code={`# Begin a session
$ pd begin --identity myapp:api:auth --purpose "Implement JWT refresh" --lifecycle durable

# Add notes as you work (immutable, append-only)
$ pd note "Added refresh token endpoint at /api/auth/refresh"
$ pd note "Updated middleware to check token expiry"

# Claim files to flag likely conflicts (advisory)
$ pd session files add src/auth/refresh.ts

# Complete the session
$ pd done`}
          output={`Session s-a1b2c3 started
Note added to session s-a1b2c3
Note added to session s-a1b2c3
File claimed: src/auth/refresh.ts
Session s-a1b2c3 completed (3 notes, 1 file claim)`}
        />
      </div>

      {/* Session Lifecycle */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Session Lifecycle</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Sessions move through a simple state machine. Notes and file claims accumulate
          during the active phase and persist after completion for audit purposes.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">active</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Work in progress</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Notes and file claims accepted</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">completed</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Work finished normally</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Read-only, audit trail preserved</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">abandoned</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Agent crashed or timed out</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Eligible for salvage by another agent</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd begin</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Start a new session with an identity and purpose. Returns a session ID for subsequent commands.</p>
            <DocsCodeBlock
              code={`$ pd begin --identity myapp:api:auth --purpose "Implement JWT refresh" --lifecycle durable`}
              output={`Session s-a1b2c3 started`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd note &lt;text&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Add an immutable note to the current session. Notes can never be edited or deleted individually.</p>
            <DocsCodeBlock
              code={`$ pd note "Refactored auth middleware to support refresh tokens"
$ pd note "Found edge case: expired refresh tokens return 401 not 403"`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd notes</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List recent notes across all sessions, or filter by session ID.</p>
            <DocsCodeBlock
              code={`$ pd notes --session s-a1b2c3`}
              output={`[12:01] Refactored auth middleware to support refresh tokens
[12:04] Found edge case: expired refresh tokens return 401 not 403
[12:09] Added integration test for token refresh flow`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd done</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Complete the current session. Releases file claims and marks the session as finished.</p>
            <DocsCodeBlock
              code={`$ pd done`}
              output={`Session s-a1b2c3 completed (3 notes, 1 file claim)`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd whoami</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Show the current active session, identity, and purpose.</p>
            <DocsCodeBlock
              code={`$ pd whoami`}
              output={`Session:  s-a1b2c3
Identity: myapp:api:auth
Purpose:  Implement JWT refresh
Notes:    3
Files:    1 claimed`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd session files add &lt;path&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Claim a file to signal other agents you are editing it. Advisory, not enforced.</p>
            <DocsCodeBlock
              code={`$ pd session files add src/auth/refresh.ts`}
              output={`File claimed: src/auth/refresh.ts`}
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

// Start a session
const session = await pd.sessions.begin({
  identity: 'myapp:api:auth',
  purpose: 'Implement JWT refresh'
})

// Add notes as you work
await pd.note('Added refresh endpoint', { sessionId: session.id })
await pd.note('Updated auth middleware', { sessionId: session.id })

// Complete the session
await pd.sessions.done(session.id)`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Atomic Port Assignment</div>
          <div className="text-sm text-[var(--text-muted)]">Deterministic port hashing for multi-agent services</div>
        </div>
        <Link
          to="/docs/features/ports"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
