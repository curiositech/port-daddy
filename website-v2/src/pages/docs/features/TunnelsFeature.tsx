import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function TunnelsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Tunnels
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Tunnels
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Expose local services to the internet via tunnel providers. Port Daddy wraps ngrok,
          Cloudflare Tunnel, and localtunnel with automatic lifecycle management tied to your
          port claims.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
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
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        </div>
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

# Check which providers are installed
$ pd tunnel providers

# List all active tunnels
$ pd tunnel list`}
          output={`Tunnel ready: https://abc123.ngrok.io -> localhost:3001
ngrok         installed   v3.5.0
cloudflared   installed   v2024.1.2
localtunnel   not found
myapp:api   -> https://abc123.ngrok.io   ngrok   5m uptime
myapp:web   -> https://def456.ngrok.io   ngrok   2m uptime`}
        />
      </div>

      {/* Provider Support */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Supported Providers</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy auto-detects which provider CLIs are installed on your system and picks the
          best available one. You can override with the <code className="text-[var(--brand-primary)]">--provider</code> flag.
          You must install the provider yourself — Port Daddy wraps them, it does not bundle them.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">ngrok</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Stable URLs, auth, dashboard</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Best for webhooks and APIs</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">cloudflared</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Cloudflare network, free tier</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Best for web previews</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">localtunnel</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Zero config, no signup</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Best for quick sharing</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd tunnel start &lt;identity&gt; --provider &lt;name&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Start a tunnel for a claimed service. Auto-selects provider if not specified.</p>
            <DocsCodeBlock
              code={`$ pd tunnel start myapp:api --provider ngrok`}
              output={`Tunnel ready: https://abc123.ngrok.io -> localhost:3001`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd tunnel stop &lt;identity&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Tear down the tunnel for a service. Also happens automatically when the port is released.</p>
            <DocsCodeBlock
              code={`$ pd tunnel stop myapp:api`}
              output={`Tunnel stopped for myapp:api`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd tunnel list</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all active tunnels with public URLs, providers, and uptime.</p>
            <DocsCodeBlock
              code={`$ pd tunnel list --json`}
              output={`[
  {
    "identity": "myapp:api",
    "url": "https://abc123.ngrok.io",
    "provider": "ngrok",
    "uptime": "5m"
  }
]`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd tunnel providers</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Check which tunnel provider CLIs are installed on the system.</p>
            <DocsCodeBlock
              code={`$ pd tunnel providers`}
              output={`ngrok         installed   v3.5.0
cloudflared   installed   v2024.1.2
localtunnel   not found`}
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
          output={`Public URL: https://abc123.ngrok.io
myapp:api -> https://abc123.ngrok.io`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Always-On Avatars</div>
          <div className="text-sm text-[var(--text-muted)]">Persistent background agents that survive session boundaries</div>
        </div>
        <Link
          to="/docs/features/avatars"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
