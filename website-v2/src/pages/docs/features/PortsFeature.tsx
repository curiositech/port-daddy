import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'

export default function PortsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Core</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Atomic Port Assignment
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Deterministic hashing ensures semantic identities like <code>myapp:api</code> always
          map to the same port across restarts and swarms. No more port conflicts.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-3">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          When multiple AI agents work on the same project, they often need to spin up services
          on specific ports. Without coordination, this leads to:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Port conflicts when two agents claim the same port</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Hardcoded ports in configuration files</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Configuration drift between environments</span>
          </li>
        </ul>
      </div>

      {/* The Solution */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy uses deterministic hashing to map semantic identities to ports.
          The same identity always gets the same port, across restarts, across machines.
        </p>

        <CodeBlock language="bash">{`# Identity format: project:stack:context
$ pd claim myapp:api:main
Port 3001 assigned to myapp:api:main

# Same identity, same port — idempotent
$ pd claim myapp:api:main
Port 3001 assigned to myapp:api:main`}</CodeBlock>
      </div>

      {/* Identity Format */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Identity Format</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Identities follow a hierarchical format: <code className="text-[var(--brand-primary)]">project:stack:context</code>
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">project</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Your project name</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., myapp, frontend, api</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">stack</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Service layer</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., api, web, worker</p>
          </div>
          <div className="p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">context</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Environment/context</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">e.g., main, dev, test</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-3">
          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd claim &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Claim a port for a service. Idempotent — returns the same port on repeat calls.</p>
            <CodeBlock language="bash">{`$ pd claim myapp:api:main --json`}</CodeBlock>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd release &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Release a port claim. Safe to call even if the port is not claimed.</p>
            <CodeBlock language="bash">{`$ pd release myapp:api:main`}</CodeBlock>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd find &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Look up the port assigned to an identity without claiming a new one.</p>
            <CodeBlock language="bash">{`$ pd find myapp:api:main --quiet
3001`}</CodeBlock>
          </div>

          <div className="border-l-4 border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd services</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all active port claims with identity, port, and last-seen timestamp.</p>
            <CodeBlock language="bash">{`$ pd services
myapp:api:main 3001 5s ago
myapp:frontend:main 3000 2s ago`}</CodeBlock>
          </div>
        </div>
      </div>

      {/* Auto-Detection */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Auto-Detection</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy can scan your project and automatically detect services based on
          framework signatures (package.json, Cargo.toml, etc.).
        </p>

        <CodeBlock language="bash">{`$ pd scan ./services
Found 4 services:
    myapp:api → 3001 (express)
    myapp:frontend → 3000 (vite)
    myapp:jobs → 3002 (bullmq)
    myapp:db-admin → 3003 (adminer)`}</CodeBlock>
      </div>

      {/* SDK Example */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">SDK Usage</h2>

        <CodeBlock language="typescript">{`import { PortDaddy } from 'port-daddy'

const pd = new PortDaddy()

// Claim a port
const port = await pd.claim('myapp:api:main')
console.log(\`Server running on port \${port}\`)

// Release when done
await pd.release('myapp:api:main')`}</CodeBlock>
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-5 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Swarm Radio</div>
          <div className="text-sm text-[var(--text-muted)]">Pub/sub messaging for agent coordination</div>
        </div>
        <Link
          to="/docs/features/radio"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
