import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, Terminal } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

const SDK_MODULES = [
  {
    name: 'Ports',
    description: 'Claim, release, and manage ports for your services with deterministic assignment.',
    href: '/docs/sdk/ports',
    functions: ['claimPort()', 'releasePort()', 'findPort()', 'listServices()'],
    badge: 'Core'
  },
  {
    name: 'Sessions',
    description: 'Start agent sessions, track work context, and manage session lifecycle.',
    href: '/docs/sdk/sessions',
    functions: ['beginSession()', 'doneSession()', 'addNote()', 'getNotes()'],
    badge: 'Core'
  },
  {
    name: 'Locks',
    description: 'Distributed locks for preventing conflicts in multi-agent environments.',
    href: '/docs/sdk/locks',
    functions: ['acquireLock()', 'releaseLock()', 'withLock()'],
    badge: 'New'
  },
  {
    name: 'Messaging',
    description: 'Pub/sub messaging via Swarm Radio for agent coordination.',
    href: '/docs/sdk/subscribe',
    functions: ['publish()', 'subscribe()'],
    badge: 'Core'
  },
  {
    name: 'Harbors',
    description: 'Cryptographic capability namespaces for secure agent operations.',
    href: '/docs/sdk/harbors',
    functions: ['createHarbor()', 'enterHarbor()', 'issueHarborCard()'],
    badge: 'New'
  },
]

function CodeBlock({ code }: { code: string }) {
  return <DocsCodeBlock code={code} language="typescript" />
}

export default function SdkOverview() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="default">v3.7.0</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          TypeScript SDK
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Programmatic access to Port Daddy's port management, session tracking,
          and agent coordination features. Build multi-agent workflows with type safety.
        </p>
        <p className="text-sm text-[var(--text-muted)] p-3 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)] max-w-xl">
          Use this reference if you are writing JavaScript or TypeScript that coordinates agents
          programmatically. For terminal usage see the{' '}
          <a href="/docs/cli" className="text-[var(--brand-primary)] hover:underline">CLI reference</a>, or
          for LLM tool calls see the{' '}
          <a href="/docs/mcp" className="text-[var(--brand-primary)] hover:underline">MCP reference</a>.
        </p>
      </div>

      {/* Installation */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Installation</h2>
        <p className="text-[var(--text-secondary)]">
          Install the SDK via npm, yarn, or pnpm:
        </p>
        <CodeBlock code="npm install @port-daddy/sdk" />
        <div className="flex gap-4 text-sm text-[var(--text-muted)]">
          <code>yarn add @port-daddy/sdk</code>
          <code>pnpm add @port-daddy/sdk</code>
        </div>
      </div>

      {/* Quick Start */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Quick Start</h2>
        <p className="text-[var(--text-secondary)]">
          Get up and running in seconds:
        </p>
        <CodeBlock code={`import { PortDaddy } from '@port-daddy/sdk'

const pd = new PortDaddy()

// Claim a port for your service
const port = await pd.ports.claim('myapp:api:main')
console.log(\`Server running on port \${port}\`)

// Start a session for tracking
const session = await pd.sessions.begin({
  identity: 'myapp:api',
  purpose: 'Building new feature'
})

// Do work...

// End session when done
await pd.sessions.done(session.id)`} />
      </div>

      {/* SDK Modules */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Modules</h2>
        <p className="text-[var(--text-secondary)]">
          The SDK is organized into focused modules:
        </p>
        <div className="grid gap-4">
          {SDK_MODULES.map(module => (
            <Link
              key={module.name}
              to={module.href}
              className="group p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">{module.name}</h3>
                    <Badge variant={module.badge === 'New' ? 'gold' : 'success'}>{module.badge}</Badge>
                  </div>
                  <p className="text-sm text-[var(--text-muted)] mb-3">{module.description}</p>
                  <div className="flex flex-wrap gap-2">
                    {module.functions.map(fn => (
                      <code 
                        key={fn}
                        className="text-xs px-2 py-1 rounded bg-[var(--code-bg)] text-[var(--brand-primary)] font-mono"
                      >
                        {fn}
                      </code>
                    ))}
                  </div>
                </div>
                <ArrowRight 
                  size={18} 
                  className="text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] group-hover:translate-x-1 transition-all shrink-0 mt-1" 
                />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Configuration</h2>
        <p className="text-[var(--text-secondary)]">
          The SDK connects to the Port Daddy daemon. Configure it via environment variables or options:
        </p>
        <CodeBlock code={`// Environment variable
export PORT_DADDY_SOCKET=/tmp/port-daddy.sock

// Or pass options
const pd = new PortDaddy({
  socket: '/tmp/port-daddy.sock',
  timeout: 30000,
  project: 'myapp'
})`} />
      </div>

      {/* Type Safety */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">Full Type Safety</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          The SDK is written in TypeScript and provides complete type definitions:
        </p>
        <CodeBlock code={`import { PortClaimOptions, Session, PortClaim } from '@port-daddy/sdk'

// All types are fully exported
const options: PortClaimOptions = {
  identity: 'myapp:api',
  ttl: 3600,
  project: 'myapp'
}

const claim: PortClaim = await pd.ports.claim('myapp:api', options)`} />
      </div>

      {/* Related */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Also See</div>
          <div className="font-semibold text-[var(--text-primary)]">CLI Reference</div>
          <div className="text-sm text-[var(--text-muted)]">Command-line interface documentation</div>
        </div>
        <Link 
          to="/docs/cli"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          <Terminal size={16} />
          View CLI
        </Link>
      </div>
    </div>
  )
}
