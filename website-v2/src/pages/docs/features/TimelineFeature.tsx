import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function TimelineFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Observability</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Activity Timeline
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          An append-only audit trail of every operation across the daemon. Filter by type,
          time range, or identity to reconstruct exactly what happened and when.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
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
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
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
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Event Types</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The timeline captures every category of daemon operation, giving you complete
          visibility into the system.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">claim / release</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Port assignments</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Who claimed what port and when</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">lock / unlock</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Distributed locks</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Lock acquisition and release events</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">session / note</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Work tracking</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Session lifecycle and note additions</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd activity</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Show recent activity across all operations. Defaults to the last 50 entries.</p>
            <DocsCodeBlock
              code={`$ pd activity`}
              output={`12:01:03  claim    myapp:api:main → port 3001
12:01:05  claim    myapp:frontend:main → port 3000
12:02:11  lock     deploy:staging acquired
12:03:44  note     session s-a1b2c3: "Added refresh endpoint"
12:05:02  unlock   deploy:staging released`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd activity --type &lt;type&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Filter activity by operation type. Useful for tracing specific categories of events.</p>
            <DocsCodeBlock
              code={`$ pd activity --type claim`}
              output={`12:01:03  claim  myapp:api:main → port 3001
12:01:05  claim  myapp:frontend:main → port 3000
11:45:22  claim  myapp:worker:main → port 3002`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd activity --since &lt;duration&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Show activity within a time window. Supports human-friendly durations like 1h, 30m, 2d.</p>
            <DocsCodeBlock
              code={`$ pd activity --since 1h`}
              output={`Activity in the last 1 hour:
  23 events (12 claims, 5 notes, 3 locks, 2 releases, 1 session)`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd activity</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Get an aggregate summary of activity grouped by operation type.</p>
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
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>

        <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
          <div className="text-sm font-medium text-[var(--text-muted)] mb-3">TypeScript</div>
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
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">DNS & Tunnels</div>
          <div className="text-sm text-[var(--text-muted)]">Expose local services with automatic tunnel management</div>
        </div>
        <Link
          to="/docs/features/dns"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
