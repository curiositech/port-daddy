import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function AvatarsFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="gold">Coming in v4</Badge>
          <Badge variant="default">Agents</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Always-On Avatars (v4)
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Persistent background agents that survive session boundaries. Register an avatar once
          and Port Daddy keeps it running with automatic heartbeats, crash recovery, and
          harbor-scoped state.
        </p>
      </div>

      {/* v4 Notice */}
      <div className="p-5 rounded-xl border border-[var(--brand-accent)]/30 bg-[var(--brand-accent)]/5">
        <p className="text-[var(--text-secondary)] leading-relaxed">
          <strong className="text-[var(--text-primary)]">This feature is not yet available.</strong>{' '}
          Always-On Avatars are planned for Port Daddy v4. The design below reflects the target
          architecture and API. Nothing described on this page works today.
        </p>
      </div>

      {/* The Motivation */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Motivation</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
          Background tasks like file watchers, log monitors, and build agents are tied to the
          session that spawned them. When that session ends, everything dies:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>File watchers stop when the spawning agent's context window fills up</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Build monitors lose track of CI pipelines mid-run</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No way to run persistent background tasks without manual process management</span>
          </li>
        </ul>
      </div>

      {/* Planned Design */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Planned Design</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Avatars will be a special class of agent that Port Daddy manages end-to-end. The daemon
          will maintain their heartbeats, detect crashes, and automatically respawn them. Their
          state will persist in SQLite across restarts.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Register</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Agent starts with --avatar flag</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Persisted to SQLite, heartbeat begins</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Auto-Respawn</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Crash detected via missed heartbeat</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Port Daddy restarts the avatar automatically</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Deregister</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Explicit unregister or manual stop</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">State preserved for future sessions</p>
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
          code={`# Register a persistent avatar agent (planned)
$ pd agent register --avatar --identity myapp:watcher --purpose "Watch for file changes"
Avatar registered: myapp:watcher
Persistent heartbeat enabled (auto-respawn on failure)

# List agents — avatars shown with type and uptime (planned)
$ pd agents
AGENT              TYPE      STATUS    UPTIME    PURPOSE
myapp:watcher      avatar    active    2h 15m    Watch for file changes
myapp:deployer     avatar    active    45m       Auto-deploy on green CI
myapp:api-agent    standard  active    10m       Building auth endpoints

# Stop an avatar (planned)
$ pd agent unregister myapp:watcher`}
        />
      </div>

      {/* What Works Today */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">What Works Today</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Port Daddy already supports{' '}
          <Link to="/docs/features/salvage" className="text-[var(--brand-primary)] hover:underline">
            agent registration and salvage
          </Link>
          . You can register agents with identities, send heartbeats, and recover dead agents'
          work via the salvage system. Avatars will build on this foundation by adding
          daemon-managed lifecycle, auto-respawn, and persistent state.
        </p>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          You can also use{' '}
          <Link to="/docs/features/spawn" className="text-[var(--brand-primary)] hover:underline">
            pd spawn
          </Link>{' '}
          to launch AI agents today, though spawned agents are tied to the current session and
          do not auto-respawn.
        </p>
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Atomic Port Assignment</div>
          <div className="text-sm text-[var(--text-muted)]">Deterministic hashing for conflict-free port management</div>
        </div>
        <Link
          to="/docs/features/ports"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
