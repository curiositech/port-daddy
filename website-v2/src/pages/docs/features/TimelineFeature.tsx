import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function TimelineFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Timeline
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Activity Timeline
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          A running record of every operation, written once and never changed. Filter by type,
          time range, or identity to reconstruct what happened and when.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          With multiple agents operating concurrently, understanding what happened — and in what
          order — is critical for debugging, auditing, and post-mortems. Without a timeline:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No way to trace the sequence of events that led to a failure</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Port conflicts and lock contention happen silently with no record</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Impossible to answer "who released that port?" or "when did that deploy start?"</span>
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
          Every operation that hits the daemon is logged to an append-only SQLite table with
          a timestamp, operation type, identity, and details. The log is queryable by type,
          time range, and identity, making it easy to reconstruct the history of any resource.
        </p>

        <DocsCodeBlock
          code={`# View recent activity
$ pd activity

# Filter by operation type
$ pd activity --type claim

# Filter by time range
$ pd activity --since 1h

# Get a summary of activity by type
$ pd activity`}
          output={`Recent activity:
  12:01:03  claim    myapp:api:main → port 3001
  12:01:05  claim    myapp:frontend:main → port 3000
  12:02:11  lock     deploy:staging acquired by agent-abc123
  12:03:44  note     session s-a1b2c3: "Added refresh endpoint"
  12:05:02  unlock   deploy:staging released by agent-abc123
  12:05:03  release  myapp:frontend:main → port 3000 freed`}
        />
      </div>

      {/* Event Types */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Event Types</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The timeline captures every category of daemon operation, giving you complete
          visibility into the system.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">claim / release</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Port assignments</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Who claimed what port and when</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">lock / unlock</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Distributed locks</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Lock acquisition and release events</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">session / note</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Work tracking</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Session lifecycle and note additions</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd activity</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Show recent activity across all operations. Defaults to the last 50 entries.</p>
            <DocsCodeBlock
              code={`$ pd activity`}
              output={`12:01:03  claim    myapp:api:main → port 3001
12:01:05  claim    myapp:frontend:main → port 3000
12:02:11  lock     deploy:staging acquired
12:03:44  note     session s-a1b2c3: "Added refresh endpoint"
12:05:02  unlock   deploy:staging released`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd activity --type &lt;type&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Filter activity by operation type. Useful for tracing specific categories of events.</p>
            <DocsCodeBlock
              code={`$ pd activity --type claim`}
              output={`12:01:03  claim  myapp:api:main → port 3001
12:01:05  claim  myapp:frontend:main → port 3000
11:45:22  claim  myapp:worker:main → port 3002`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd activity --since &lt;duration&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Show activity within a time window. Supports human-friendly durations like 1h, 30m, 2d.</p>
            <DocsCodeBlock
              code={`$ pd activity --since 1h`}
              output={`Activity in the last 1 hour:
  23 events (12 claims, 5 notes, 3 locks, 2 releases, 1 session)`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd activity</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Get an aggregate summary of activity grouped by operation type.</p>
            <DocsCodeBlock
              code={`$ pd activity`}
              output={`Activity summary:
  claim      142 events   last: 2s ago
  release     98 events   last: 5m ago
  note        67 events   last: 12s ago
  lock        34 events   last: 1m ago
  session     12 events   last: 8m ago`}
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

// List recent activity
const events = await pd.activity.list({ limit: 100 })
events.forEach(e => console.log(e.timestamp, e.type, e.details))

// Get activity summary
const summary = await pd.activity.summary()
console.log('Total claims:', summary.claim)
console.log('Total notes:', summary.note)

// Query a specific time range
const lastHour = await pd.activity.list({
  since: '1h',
  type: 'claim'
})`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">DNS & Tunnels</div>
          <div className="text-sm text-[var(--text-muted)]">Expose local services with automatic tunnel management</div>
        </div>
        <Link
          to="/docs/features/dns"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
