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
          <Badge variant="gold">Coming in v4</Badge>
          <Badge variant="default">Distributed</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Remote Harbors (v4)
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Cross-machine coordination for multi-agent development. Remote Harbors will connect
          Port Daddy instances across your network, enabling shared port claims, sessions,
          and messaging between machines.
        </p>
      </div>

      {/* v4 Notice */}
      <div className="p-5 rounded-xl border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/5">
        <p className="text-[var(--text-secondary)] leading-relaxed">
          <strong className="text-[var(--text-primary)]">This feature is not yet available.</strong>{' '}
          Remote Harbors are under active development for Port Daddy v4. The design below
          reflects the planned architecture and API. Nothing described on this page works today.
        </p>
      </div>

      {/* The Motivation */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Motivation</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          Port Daddy runs locally by default, but real-world agent swarms can span multiple machines.
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

      {/* Planned Architecture */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Planned Architecture</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The v4 design uses a Lighthouse discovery server to let Port Daddy instances find each
          other and establish encrypted peer-to-peer connections. Once connected, port claims,
          sessions, and pub/sub messages will sync automatically across machines.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Lighthouse</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Discovery and rendezvous server</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Peers register and find each other</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Encrypted Tunnels</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Secure peer-to-peer channels</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">All traffic encrypted in transit</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">State Sync</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Distributed state replication</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Claims, sessions, messages flow across machines</p>
          </div>
        </div>
      </div>

      {/* Planned API */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Planned API</h2>
        <p className="text-sm text-[var(--text-muted)] mb-2">
          These commands do not exist yet. They represent the target CLI surface for v4.
        </p>

        <DocsCodeBlock
          code={`# Start a Lighthouse discovery server (planned)
$ pd lighthouse start --port 9877
Lighthouse listening on 0.0.0.0:9877

# Connect to a Lighthouse from another machine (planned)
$ pd remote connect 192.168.1.10:9877
Connected to Lighthouse at 192.168.1.10:9877
Syncing port claims... 4 services discovered

# List connected peers (planned)
$ pd remote peers
PEER              ADDRESS            SERVICES   LATENCY
dev-laptop        192.168.1.20       3          2ms
ci-server         192.168.1.30       1          5ms`}
        />
      </div>

      {/* What Works Today */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">What Works Today</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          While Remote Harbors are not yet available, you can use{' '}
          <Link to="/docs/features/tunnels" className="text-[var(--brand-primary)] hover:underline">
            Tunnels
          </Link>{' '}
          to expose local services to the internet via ngrok, Cloudflare Tunnel, or localtunnel.
          Tunnels solve the "reach my localhost" problem today, while Remote Harbors will solve
          the broader "shared coordination state" problem in v4.
        </p>
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
