import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function DnsFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Networking</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Service DNS
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Semantic identity resolution — find any service by name. Register human-readable names
          that resolve to <code>host:port</code> pairs, so agents never hardcode addresses.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
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
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Service DNS lets agents register semantic names that map to network addresses. Any agent
          can resolve a name to get the current host and port — no config files, no environment
          variables, no guessing.
        </p>

        <DocsCodeBlock
          code={`# Register a service with a semantic name
$ pd dns register myapp:api localhost:3001
Service registered: myapp:api → localhost:3001

# Another agent resolves the name
$ pd dns lookup myapp:api
localhost:3001

# List all registered DNS entries
$ pd dns list
myapp:api        → localhost:3001   (2s ago)
myapp:frontend   → localhost:3000   (5s ago)
myapp:worker     → localhost:3002   (8s ago)`}
        />
      </div>

      {/* Resolution Patterns */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Resolution Patterns</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          DNS entries follow the same <code className="text-[var(--brand-primary)]">project:stack:context</code> identity
          format used everywhere in Port Daddy.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Exact Match</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Resolve a specific service</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., myapp:api:main</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Prefix Match</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Discover all services in a project</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., myapp:* returns all</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Cross-Machine</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Works across networked hosts</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., 192.168.1.10:3001</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd dns register &lt;name&gt; &lt;host:port&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Register a semantic name pointing to a host:port pair. Overwrites any existing entry.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd dns register myapp:api localhost:3001
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd dns lookup &lt;name&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Resolve a name to its host:port. Returns the address or an error if not found.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd dns lookup myapp:api --quiet{'\n'}
              localhost:3001
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd dns list</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all registered DNS entries with names, addresses, and last-updated timestamps.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd dns list --json
            </div>
          </div>
        </div>
      </div>

      {/* SDK Usage */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>

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
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Remote Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">Cross-machine coordination via the local daemon</div>
        </div>
        <Link
          to="/docs/features/remote"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
