import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function TunnelsFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Networking</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Tunnels
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Expose local services to the internet via tunnel providers. Port Daddy wraps ngrok,
          Cloudflare Tunnel, and localtunnel with automatic lifecycle management tied to your
          port claims.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          Local dev servers are invisible to the outside world. When you need to share a running
          service with a remote collaborator or receive webhook callbacks, you hit a wall:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Webhook providers like Stripe and GitHub cannot reach localhost</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Sharing a dev preview with a teammate requires manual tunnel setup</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Orphaned tunnels linger when services stop, wasting resources and creating security risks</span>
          </li>
        </ul>
      </div>

      {/* How It Works */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy spawns your tunnel provider's CLI as a child process, parses the public URL
          from its stdout, and stores it alongside your port claim in SQLite. When you release the
          port, the tunnel process is automatically killed. No orphaned tunnels, no manual cleanup.
        </p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The value is lifecycle management: tunnels are tied to port claims so they start and stop
          together, provider detection finds what you have installed, and the public URL is
          discoverable by other agents via the standard service list.
        </p>

        <DocsCodeBlock
          code={`# Expose a service via ngrok
$ pd tunnel start myapp:api --provider ngrok
Tunnel ready: https://abc123.ngrok.io → localhost:3001

# Check which providers are installed
$ pd tunnel providers
ngrok         installed  (v3.5.0)
cloudflared   installed  (v2024.1.2)
localtunnel   not found

# List all active tunnels
$ pd tunnel list
myapp:api   → https://abc123.ngrok.io   (ngrok, 5m uptime)
myapp:web   → https://def456.ngrok.io   (ngrok, 2m uptime)`}
        />
      </div>

      {/* Provider Support */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Supported Providers</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy auto-detects which provider CLIs are installed on your system and picks the
          best available one. You can override with the <code className="text-[var(--brand-primary)]">--provider</code> flag.
          You must install the provider yourself — Port Daddy wraps them, it does not bundle them.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">ngrok</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Stable URLs, auth, dashboard</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Best for webhooks and APIs</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">cloudflared</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Cloudflare network, free tier</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Best for web previews</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">localtunnel</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Zero config, no signup</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Best for quick sharing</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel start &lt;identity&gt; --provider &lt;name&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Start a tunnel for a claimed service. Auto-selects provider if not specified.</p>
            <CodeBlock language="bash">{`$ pd tunnel start myapp:api --provider ngrok`}</CodeBlock>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel stop &lt;identity&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Tear down the tunnel for a service. Also happens automatically when the port is released.</p>
            <CodeBlock language="bash">{`$ pd tunnel stop myapp:api`}</CodeBlock>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel list</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all active tunnels with public URLs, providers, and uptime.</p>
            <CodeBlock language="bash">{`$ pd tunnel list --json`}</CodeBlock>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel providers</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Check which tunnel provider CLIs are installed on the system.</p>
            <CodeBlock language="bash">{`$ pd tunnel providers`}</CodeBlock>
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

// Start a tunnel with a specific provider
const tunnel = await pd.tunnel.start('myapp:api', {
  provider: 'ngrok'
})
console.log(\`Public URL: \${tunnel.url}\`)

// List all active tunnels
const tunnels = await pd.tunnel.list()
tunnels.forEach(t => console.log(\`\${t.identity} → \${t.url}\`))

// Stop a tunnel
await pd.tunnel.stop('myapp:api')`}
        />
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Always-On Avatars</div>
          <div className="text-sm text-[var(--text-muted)]">Persistent background agents that survive session boundaries</div>
        </div>
        <Link
          to="/docs/features/avatars"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
