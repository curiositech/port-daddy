import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function RemoteFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Remote Harbors
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Remote Harbors (v4)
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Coordination across more than one machine. Remote Harbors will connect Port Daddy
          instances over your network so port claims, sessions, and messages are shared between
          machines.
        </p>
      </div>

      {/* v4 Notice */}
      <p className="text-[var(--text-secondary)] leading-relaxed border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4">
        <strong className="text-[var(--text-primary)]">This feature is not yet available.</strong>{' '}
        Remote Harbors are under active development for Port Daddy v4. The design below
        reflects the planned architecture and API. Nothing described on this page works today.
      </p>

      {/* The Motivation */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Motivation</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
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
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">02</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Planned Architecture</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          The v4 design uses a Lighthouse discovery server to let Port Daddy instances find each
          other and establish encrypted peer-to-peer connections. Once connected, port claims,
          sessions, and pub/sub messages will sync automatically across machines.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">Lighthouse</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Discovery and rendezvous server</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Peers register and find each other</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">Encrypted Tunnels</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Secure peer-to-peer channels</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">All traffic encrypted in transit</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">State Sync</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Distributed state replication</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Claims, sessions, messages flow across machines</p>
          </div>
        </div>
      </div>

      {/* Planned API */}
      <div className="space-y-4">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Planned API</h2>
        </div>
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
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">04</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">What Works Today</h2>
        </div>
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
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Tunnels</div>
          <div className="text-sm text-[var(--text-muted)]">Expose local services to the internet via tunnel providers</div>
        </div>
        <Link
          to="/docs/features/tunnels"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
