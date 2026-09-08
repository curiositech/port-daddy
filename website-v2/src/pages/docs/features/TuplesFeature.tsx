import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function TuplesFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Tuples
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Tuple Space
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          A shared scratch pad that agents read and write together. One agent posts a typed
          record (a tuple), others find it by matching on a pattern. Observers read without
          removing it; task consumers take it so no one else can. Records are scoped to a harbor
          and expire after a set time. This design is known as a tuple space.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          Pub/sub channels are great for events, but agent swarms also need a shared
          scratch pad — a place to post work items, claim tasks, and coordinate state
          without explicit point-to-point messaging.
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error,#e53e3e)] mt-1 shrink-0" />
            <span>Pub/sub is ephemeral — late subscribers miss messages already sent</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error,#e53e3e)] mt-1 shrink-0" />
            <span>Shared files create race conditions and require locking overhead</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error,#e53e3e)] mt-1 shrink-0" />
            <span>Custom databases require schema design and migration management</span>
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
          The tuple space is a persistent, SQLite-backed store of JSON arrays. Each tuple
          is an ordered list of typed values. Agents write tuples with{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">out</code>,
          read non-destructively with{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">rd</code>,
          and consume destructively with{' '}
          <code className="text-[var(--brand-primary)] font-mono text-sm">in</code>.
          Pattern matching uses wildcards and numeric comparisons across any field position.
        </p>

        <DocsCodeBlock
          code={`# Write a task tuple
pd tuple out '["task", "build", "pending", 1]'

# Read all pending tasks (non-destructive)
pd tuple rd '["task", "*", "pending", "*"]'

# Take (consume) the highest-priority pending task
pd tuple in '["task", "*", "pending", ">0"]' --limit 1

# List everything in the space
pd tuple scan`}
          output={`Tuple written: 42

2 tuple(s) matched
  42: ["task","build","pending",1]
  38: ["task","test","pending",2]

1 tuple(s) taken
  42: ["task","build","pending",1]

2 tuple(s) in space
  38: ["task","test","pending",2]
  41: ["result","build","done"]`}
        />
      </div>

      {/* Pattern Matching */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Pattern Matching</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Patterns are JSON arrays where each position is either an exact value or a matcher.
          Shorter patterns match longer tuples — only the specified positions are checked.
        </p>

        <div className="space-y-2">
          {[
            { pattern: '"*"', desc: 'Match any value at this position' },
            { pattern: '">N"', desc: 'Match numbers strictly greater than N (e.g. ">5" matches 6, 7, 100)' },
            { pattern: '"<N"', desc: 'Match numbers strictly less than N (e.g. "<10" matches 0, 1, 9)' },
            { pattern: 'value', desc: 'Exact match — string, number, boolean, or null' },
          ].map(({ pattern, desc }) => (
            <div key={pattern} className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--border-subtle)] pl-4 py-1">
              <code className="text-[var(--brand-primary)] font-mono text-sm shrink-0 mt-0.5">{pattern}</code>
              <span className="text-sm text-[var(--text-secondary)]">{desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Harbor Scoping */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Harbor Scoping</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Tuples can be scoped to a harbor namespace. Harbor-scoped reads and writes never
          see tuples from other harbors. Use this to give each project or fleet its own
          isolated tuple space without naming collisions.
        </p>
        <DocsCodeBlock
          code={`# Write into the "myapp" harbor
pd tuple out '["task", "review", "queued"]' --harbor myapp

# Only reads tuples in "myapp" harbor
pd tuple rd '["task", "*", "queued"]' --harbor myapp`}
          output={`Tuple written: 7

1 tuple(s) matched
  7: ["task","review","queued"]`}
        />
      </div>

      {/* TTL */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">TTL-Based Expiry</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Tuples can be written with a time-to-live in milliseconds. Expired tuples are
          pruned automatically on every read operation.
        </p>
        <DocsCodeBlock
          code={`# Expires in 60 seconds
pd tuple out '["heartbeat", "agent-1", "alive"]' --ttl 60000

# Expires in 5 minutes
pd tuple out '["lock-intent", "src/auth.ts", "agent-2"]' --ttl 300000`}
        />
      </div>

      {/* Multi-Agent Coordination */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Multi-Agent Coordination</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          A producer agent writes work items; N consumer agents race to take them.
          The destructive <code className="text-[var(--brand-primary)] font-mono text-sm">in</code> operation
          is atomic — only one consumer gets each tuple, eliminating double-processing.
        </p>
        <DocsCodeBlock
          language="typescript"
          code={`import { PortDaddy } from 'port-daddy'
const pd = new PortDaddy()

// Producer: post tasks into the shared space
await pd.tupleOut(['task', 'lint', 'pending', 1], { harbor: 'myapp' })
await pd.tupleOut(['task', 'test', 'pending', 2], { harbor: 'myapp' })
await pd.tupleOut(['task', 'build', 'pending', 3], { harbor: 'myapp' })

// Consumer: atomically claim the next pending task
const { taken } = await pd.tupleIn(
  ['task', '*', 'pending', '*'],
  { harbor: 'myapp', limit: 1 }
)
if (taken.length > 0) {
  const [, taskName] = taken[0].fields as [string, string, string, number]
  console.log('Claimed task:', taskName)
}

// Observer: read without consuming
const { tuples } = await pd.tupleRd(
  ['task', '*', 'pending', '*'],
  { harbor: 'myapp' }
)
console.log('Remaining tasks:', tuples.length)`}
        />
      </div>

      {/* API Endpoints */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">07</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">API Endpoints</h2>
        </div>

        <div className="space-y-2">
          {[
            { method: 'POST', path: '/tuples', desc: 'Write a tuple (out). Body: { fields, harbor?, writtenBy?, ttlMs? }' },
            { method: 'GET', path: '/tuples', desc: 'Read tuples by pattern (rd). Query: ?pattern=[]&harbor=&limit=' },
            { method: 'DELETE', path: '/tuples', desc: 'Take tuples by pattern (in). Body: { pattern, harbor?, limit? }' },
            { method: 'GET', path: '/tuples/scan', desc: 'List all tuples. Query: ?harbor=' },
            { method: 'GET', path: '/tuples/count', desc: 'Count tuples. Query: ?harbor=' },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 border-l-[length:var(--lw-stripe)] border-[var(--border-subtle)] pl-4 py-1">
              <span className={`text-[length:var(--type-meta-size)] font-mono font-bold px-2 py-0.5 shrink-0 mt-0.5 ${
                method === 'POST'
                  ? 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)]'
                  : method === 'DELETE'
                  ? 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)]'
                  : 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
              }`}>
                {method}
              </span>
              <div>
                <code className="text-sm font-mono text-[var(--text-primary)]">{path}</code>
                <p className="text-sm text-[var(--text-secondary)] mt-1">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Related Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">Scope tuple spaces and locks to named capability namespaces</div>
        </div>
        <Link
          to="/docs/features/harbors"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
