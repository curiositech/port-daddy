import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'

export default function PortsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Ports
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Atomic Port Assignment
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          A name like <code>myapp:api</code> always maps to the same port — across restarts and
          across agents working at once. The mapping is computed from the name, so two agents that
          ask for the same name get the same port and never collide.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
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
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy uses deterministic hashing to map semantic identities to ports.
          The same identity always gets the same port, across restarts, across machines.
        </p>

        <DocsCodeBlock
          code={`# Identity format: project:stack:context
$ pd claim myapp:api:main

# Same identity, same port — idempotent
$ pd claim myapp:api:main`}
          output={`Port 3001 assigned to myapp:api:main
Port 3001 assigned to myapp:api:main`}
        />
      </div>

      {/* Identity Format */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Identity Format</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Identities follow a hierarchical format: <code className="text-[var(--brand-primary)]">project:stack:context</code>
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">project</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Your project name</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., myapp, frontend, api</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">stack</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Service layer</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., api, web, worker</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">context</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Environment/context</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">e.g., main, dev, test</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd claim &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Claim a port for a service. Idempotent — returns the same port on repeat calls.</p>
            <DocsCodeBlock
              code={`$ pd claim myapp:api:main --json`}
              output={`{
  "identity": "myapp:api:main",
  "port": 3001,
  "status": "claimed"
}`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd release &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Release a port claim. Safe to call even if the port is not claimed.</p>
            <DocsCodeBlock
              code={`$ pd release myapp:api:main`}
              output={`Released myapp:api:main from port 3001`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd find &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Look up the port assigned to an identity without claiming a new one.</p>
            <DocsCodeBlock
              code={`$ pd find myapp:api:main --quiet`}
              output={`3001`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd services</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all active port claims with identity, port, and last-seen timestamp.</p>
            <DocsCodeBlock
              code={`$ pd services`}
              output={`myapp:api:main       3001   5s ago
myapp:frontend:main  3000   2s ago`}
            />
          </div>
        </div>
      </div>

      {/* Auto-Detection */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Auto-Detection</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy can scan your project and automatically detect services based on
          framework signatures (package.json, Cargo.toml, etc.).
        </p>

        <DocsCodeBlock
          code={`$ pd scan ./services`}
          output={`Found 4 services:
  myapp:api       -> 3001   express
  myapp:frontend  -> 3000   vite
  myapp:jobs      -> 3002   bullmq
  myapp:db-admin  -> 3003   adminer`}
        />
      </div>

      {/* SDK Example */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>
        </div>

        <DocsCodeBlock
          language="typescript"
          code={`import { PortDaddy } from 'port-daddy'

const pd = new PortDaddy()

// Claim a port
const port = await pd.claim('myapp:api:main')
console.log(\`Server running on port \${port}\`)

// Release when done
await pd.release('myapp:api:main')`}
          output={`Server running on port 3001`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Swarm Radio</div>
          <div className="text-sm text-[var(--text-muted)]">Pub/sub messaging for agent coordination</div>
        </div>
        <Link
          to="/docs/features/radio"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
