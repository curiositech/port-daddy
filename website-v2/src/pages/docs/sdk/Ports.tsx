import { Badge } from '@/components/ui/Badge'
import { DocsCodeBlock as CodeBlock } from '@/components/docs/DocsCodeBlock'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function PortsSdk() {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">SDK</Link>
        <span>/</span>
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">Modules</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">Ports</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Ports Module
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          Claim, release, and manage ports for your services with deterministic assignment.
          The same identity always receives the same port.
        </p>
      </div>

      {/* claimPort */}
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">claimPort()</h2>
          <p className="text-[var(--text-secondary)]">
            Claim a port for a service identity. Idempotent — returns the same port on repeat calls.
          </p>
        </div>

        <CodeBlock language="typescript" code={`claimPort(identity: string, options?: PortClaimOptions): Promise<PortClaim>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">identity</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Semantic identity in format <code>project:stack:context</code>
              </p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.project</code>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Project name (optional, inferred from identity)</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.ttl</code>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Time-to-live in seconds (optional)</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.preferredPort</code>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">number</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Preferred port number (optional, best effort)</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Basic usage — claim a port for an API service</p>
            <CodeBlock
              language="typescript"
              code={`const claim = await pd.ports.claim('myapp:api:main')
console.log(claim.port) // 3001`}
              output={`{
  "identity": "myapp:api:main",
  "port": 3001,
  "claimedAt": "2026-03-16T12:00:00Z",
  "ttl": null,
  "status": "active"
}`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">With TTL — port auto-releases after 1 hour</p>
            <CodeBlock
              language="typescript"
              code={`const claim = await pd.ports.claim('myapp:worker:temp', {
  ttl: 3600 // 1 hour
})`}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[var(--text-secondary)]">Idempotent — same call returns same port</p>
            <CodeBlock
              language="typescript"
              code={`const claim1 = await pd.ports.claim('myapp:api:main')
const claim2 = await pd.ports.claim('myapp:api:main')
console.log(claim1.port === claim2.port) // true`}
            />
          </div>
        </div>
      </div>

      {/* releasePort */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">releasePort()</h2>
          <p className="text-[var(--text-secondary)]">
            Release a previously claimed port. Safe to call even if the port is not claimed.
          </p>
        </div>

        <CodeBlock language="typescript" code={`releasePort(identity: string): Promise<boolean>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">identity</code>
                <Badge variant="default" size="sm">required</Badge>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">The identity to release</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Release when service shuts down
await pd.ports.release('myapp:api:main')

// Returns true if released, false if not found
const released = await pd.ports.release('myapp:api:main')
console.log(released) // true`}
          />
        </div>
      </div>

      {/* findPort */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">findPort()</h2>
          <p className="text-[var(--text-secondary)]">
            Find the port assigned to an identity without claiming. Returns null if not claimed.
          </p>
        </div>

        <CodeBlock language="typescript" code={`findPort(identity: string): Promise<PortClaim | null>`} />

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// Check if a service is already running
const claim = await pd.ports.findPort('myapp:api:main')
if (claim) {
  console.log(\`Service running on port \${claim.port}\`)
} else {
  console.log('Service not running')
}`}
          />
        </div>
      </div>

      {/* listServices */}
      <div className="space-y-6 pt-8 border-t border-[var(--border-subtle)]">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">listServices()</h2>
          <p className="text-[var(--text-secondary)]">
            List all active port claims with optional filtering by project.
          </p>
        </div>

        <CodeBlock language="typescript" code={`listServices(options?: ListServicesOptions): Promise<PortClaim[]>`} />

        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h3>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.project</code>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">string</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Filter by project name (optional)</p>
            </div>
            <div className="p-4 bg-[var(--surface-raised)]">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono text-[var(--brand-primary)]">options.status</code>
                <span className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">'active' | 'expired' | 'all'</span>
              </div>
              <p className="text-sm text-[var(--text-muted)] mt-1">Filter by status (default: 'active')</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h3>
          <CodeBlock
            language="typescript"
            code={`// List all services in a project
const services = await pd.ports.listServices({ project: 'myapp' })
console.log(services)`}
            output={`[
  {
    "identity": "myapp:api:main",
    "port": 3001,
    "claimedAt": "2026-03-16T12:00:00Z",
    "status": "active"
  },
  {
    "identity": "myapp:frontend:main",
    "port": 3000,
    "claimedAt": "2026-03-16T11:58:00Z",
    "status": "active"
  }
]`}
          />
        </div>
      </div>

      {/* Types */}
      <div className="space-y-4 pt-8 border-t border-[var(--border-subtle)]">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Type Definitions</h2>
        <CodeBlock language="typescript" code={`interface PortClaim {
  identity: string
  port: number
  claimedAt: string
  expiresAt?: string
  ttl: number | null
  status: 'active' | 'expired' | 'released'
  metadata?: Record<string, unknown>
}

interface PortClaimOptions {
  project?: string
  ttl?: number
  preferredPort?: number
  metadata?: Record<string, unknown>
}

interface ListServicesOptions {
  project?: string
  status?: 'active' | 'expired' | 'all'
}`} />
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-8 border-t border-[var(--border-subtle)]">
        <Link
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          SDK Overview
        </Link>
        <Link
          to="/docs/sdk/sessions"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
        >
          Sessions Module
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
