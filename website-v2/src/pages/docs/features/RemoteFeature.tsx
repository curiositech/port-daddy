import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function RemoteFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Distributed</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Remote Harbors
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Cross-machine coordination via Lighthouse servers. Connect Port Daddy instances
          across your network into a peer-to-peer mesh with encrypted tunnels.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          Port Daddy runs locally by default, but real-world agent swarms span multiple machines.
          Without cross-machine coordination:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Agents on different machines cannot discover each other's services</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Port claims are local-only, leading to cross-machine conflicts</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Sessions and notes are invisible to agents running elsewhere</span>
          </li>
        </ul>
      </div>

      {/* How It Works */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Remote Harbors use a Lighthouse discovery server to connect Port Daddy instances into a
          peer-to-peer mesh. All traffic is encrypted with the Noise Protocol framework. Once
          connected, port claims, sessions, and messages sync automatically across machines.
        </p>

        <DocsCodeBlock
          code={`# Start a Lighthouse discovery server
$ pd lighthouse start --port 9877
Lighthouse listening on 0.0.0.0:9877

# Connect a remote harbor to the Lighthouse
$ pd tunnel myapp:api --lighthouse 192.168.1.10:9877
Noise tunnel established to 192.168.1.10:9877
Syncing port claims... 4 services discovered
Peer mesh: 3 harbors connected`}
        />
      </div>

      {/* Architecture */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Architecture</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The mesh topology ensures no single point of failure. Peers discover each other
          through the Lighthouse but communicate directly once connected.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Lighthouse</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Discovery & rendezvous server</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Peers register and find each other</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Noise Tunnels</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Encrypted peer-to-peer channels</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Noise Protocol IK handshake</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Peer Mesh</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Decentralized state sync</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Claims, sessions, messages flow</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel &lt;identity&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Open an encrypted tunnel to a remote harbor for a given service identity.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd tunnel myapp:api --lighthouse 192.168.1.10:9877
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnel stop &lt;identity&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Close the tunnel for a service. The remote harbor is notified and cleans up.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd tunnel stop myapp:api
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd tunnels</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all active tunnels with remote peer addresses, latency, and uptime.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd tunnels --json
            </div>
          </div>
        </div>
      </div>

      {/* SDK Usage */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>

        <DocsCodeBlock
          language="typescript"
          code={`import { PortDaddy } from '@port-daddy/sdk'

const pd = new PortDaddy()

// Start a tunnel to a remote harbor
await pd.tunnel.start('myapp:api', {
  lighthouse: '192.168.1.10:9877'
})

// Check tunnel status
const status = await pd.tunnel.status('myapp:api')
console.log(\`Tunnel latency: \${status.latencyMs}ms\`)

// Stop tunnel when done
await pd.tunnel.stop('myapp:api')`}
        />
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Tunnels</div>
          <div className="text-sm text-[var(--text-muted)]">Expose local services to the internet via tunnel providers</div>
        </div>
        <Link
          to="/docs/features/tunnels"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
