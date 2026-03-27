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
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Agents</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Always-On Avatars
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Persistent background agents that survive session boundaries. Register an avatar once
          and it keeps running — with automatic heartbeats, respawning, and harbor-scoped state.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
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

      {/* How It Works */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Avatars are agents registered with the <code className="text-[var(--brand-primary)]">--avatar</code> flag.
          Port Daddy manages their lifecycle: persistent heartbeats keep them alive, automatic
          respawning recovers from crashes, and harbor-scoped state persists across restarts.
        </p>

        <DocsCodeBlock
          code={`# Register a persistent avatar agent
$ pd agent register --avatar --identity myapp:watcher --purpose "Watch for file changes and rebuild"
Avatar registered: myapp:watcher
Persistent heartbeat enabled (auto-respawn on failure)

# Check running avatars
$ pd agents
AGENT              TYPE      STATUS    UPTIME    PURPOSE
myapp:watcher      avatar    active    2h 15m    Watch for file changes and rebuild
myapp:deployer     avatar    active    45m       Auto-deploy on green CI
myapp:api-agent    standard  active    10m       Building auth endpoints`}
        />
      </div>

      {/* Avatar Lifecycle */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Avatar Lifecycle</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Avatars follow a managed lifecycle that keeps them running across session boundaries
          and recovers automatically from failures.
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
            <p className="text-xs text-[var(--text-muted)] mt-1">Port Daddy restarts the avatar</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">Deregister</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Explicit unregister or manual stop</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">State preserved for future sessions</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd agent register --avatar --identity &lt;id&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Register a persistent avatar agent. Survives session boundaries with auto-respawn.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd agent register --avatar --identity myapp:watcher --purpose "File watcher"
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd agents</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all registered agents. Avatars show type, uptime, and respawn count.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd agents --json
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd agent unregister &lt;id&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Stop and deregister an avatar. Its state is preserved for future reference.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd agent unregister myapp:watcher
            </div>
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd agent heartbeat &lt;id&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Send a manual heartbeat. Avatars do this automatically, but useful for custom agents.</p>
            <div className="p-3 rounded-lg font-mono text-sm" style={{ background: 'var(--code-bg)', color: 'var(--code-text)' }}>
              $ pd agent heartbeat myapp:watcher
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

// Register a persistent avatar
await pd.agents.register({
  identity: 'myapp:watcher',
  avatar: true,
  purpose: 'Watch for file changes and rebuild'
})

// List all agents (including avatars)
const agents = await pd.agents.list()
agents.forEach(a => {
  console.log(\`\${a.identity} [\${a.type}] — \${a.status}\`)
})

// Deregister when no longer needed
await pd.agents.unregister('myapp:watcher')`}
        />
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
