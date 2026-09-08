import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function DnsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · DNS
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Service DNS
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Find any service by name instead of by address. Register a readable name that points
          to a <code>host:port</code> pair, so agents never hardcode where a service lives.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          In a multi-agent environment, services spin up on dynamic ports across different hosts.
          Agents need to discover each other but have no reliable way to look up where a service lives:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Hardcoded host:port pairs break when services restart on different ports</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No central registry means agents pass addresses through fragile env vars</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Cross-machine discovery requires manual configuration per environment</span>
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
          Service DNS lets agents register semantic names that map to network addresses. Any agent
          can resolve a name to get the current host and port — no config files, no environment
          variables, no guessing.
        </p>

        <DocsCodeBlock
          code={`# Register a service with a semantic name
$ pd dns register myapp:api localhost:3001

# Another agent resolves the name
$ pd dns lookup myapp:api

# List all registered DNS entries
$ pd dns list`}
          output={`Service registered: myapp:api -> localhost:3001
localhost:3001
myapp:api        -> localhost:3001   2s ago
myapp:frontend   -> localhost:3000   5s ago
myapp:worker     -> localhost:3002   8s ago`}
        />
      </div>

      {/* Resolution Patterns */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Resolution Patterns</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          DNS entries follow the same <code className="text-[var(--brand-primary)]">project:stack:context</code> identity
          format used everywhere in Port Daddy.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">Exact Match</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Resolve a specific service</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., myapp:api:main</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">Prefix Match</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Discover all services in a project</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., myapp:* returns all</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">Cross-Machine</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Works across networked hosts</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., 192.168.1.10:3001</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd dns register &lt;name&gt; &lt;host:port&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Register a semantic name pointing to a host:port pair. Overwrites any existing entry.</p>
            <DocsCodeBlock
              code={`$ pd dns register myapp:api localhost:3001`}
              output={`Service registered: myapp:api -> localhost:3001`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd dns lookup &lt;name&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Resolve a name to its host:port. Returns the address or an error if not found.</p>
            <DocsCodeBlock
              code={`$ pd dns lookup myapp:api --quiet`}
              output={`localhost:3001`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd dns list</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all registered DNS entries with names, addresses, and last-updated timestamps.</p>
            <DocsCodeBlock
              code={`$ pd dns list --json`}
              output={`[
  { "name": "myapp:api", "address": "localhost:3001", "updatedAgo": "2s" },
  { "name": "myapp:frontend", "address": "localhost:3000", "updatedAgo": "5s" }
]`}
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

// Register a service address
await pd.dns.register('myapp:api', 'localhost:3001')

// Resolve from another agent
const addr = await pd.dns.resolve('myapp:api')
console.log(\`API is at \${addr}\`) // localhost:3001

// List all entries
const entries = await pd.dns.list()
entries.forEach(e => console.log(\`\${e.name} → \${e.address}\`))`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Remote Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">Cross-machine coordination via the local daemon</div>
        </div>
        <Link
          to="/docs/features/remote"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
