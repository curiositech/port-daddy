import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function HarborsFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Harbors
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Harbors
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          A named role that says what an agent is meant to do — its allowed scope of work. Other
          agents can see these roles and coordinate around them. Port Daddy calls a role like this
          a harbor.
        </p>
      </div>

      {/* Advisory Notice */}
      <p className="text-[var(--text-secondary)] leading-relaxed border-l-[length:var(--lw-stripe)] border-[var(--brand-accent)] pl-4">
        <strong className="text-[var(--text-primary)]">Advisory in v1.</strong>{' '}
        In the current release, harbor capabilities are advisory — they record intent and enable
        discovery, but the daemon does not enforce them on every request. An agent that enters
        a read-only harbor can still technically write. Protocol-level enforcement is planned for v4.
      </p>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          In a multi-agent environment, every agent has full access to every operation by default.
          Without structure:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No way to express what an agent is supposed to do vs. what it can do</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Hard to discover which agents are scoped to which resources</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No audit trail of intended permissions for post-incident review</span>
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
          Harbors are named permission scopes with a declared set of capabilities. When an agent
          enters a harbor, its intended scope is recorded. Other agents can query who is in which
          harbor to understand the current division of responsibility.
        </p>

        <DocsCodeBlock
          code={`# Create a harbor with specific capabilities
$ pd harbor create reviewer --cap "code:read,notes:write,sessions:read"
Harbor "reviewer" created with 3 capabilities

# Agent enters the harbor (declares its intended scope)
$ pd harbor enter reviewer
Entered harbor: reviewer

# List all harbors and who is in them
$ pd harbors
reviewer   code:read,notes:write,sessions:read     2 agents
deployer   ports:read,ports:write,sessions:read    1 agent
observer   sessions:read,notes:read,activity:read  0 agents`}
        />
      </div>

      {/* Capability Model */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Capability Model</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Capabilities follow a <code className="text-[var(--brand-primary)]">resource:action</code> format.
          Combine them to declare precise permission scopes for each agent role. In v1 these are
          advisory labels; in v4 they will be enforced by the daemon.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">code:read</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Read source files</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Scan, list projects, view configs</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">notes:write</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Append session notes</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Add notes, quick notes</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">ports:write</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Manage port claims</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">Claim, release, cleanup ports</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd harbor create &lt;name&gt; --cap &lt;capabilities&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Create a named harbor with a comma-separated list of capabilities.</p>
            <DocsCodeBlock
              code={`$ pd harbor create deployer --cap "ports:read,ports:write,sessions:read,notes:write"`}
              output={`Harbor "deployer" created with 4 capabilities`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd harbor enter &lt;name&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Enter a harbor to declare your agent's intended scope.</p>
            <DocsCodeBlock
              code={`$ pd harbor enter deployer`}
              output={`Entered harbor: deployer
Capabilities: ports:read, ports:write, sessions:read, notes:write`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd harbors</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all defined harbors with their capabilities and active agent count.</p>
            <DocsCodeBlock
              code={`$ pd harbors`}
              output={`reviewer   code:read,notes:write,sessions:read     2 agents
deployer   ports:read,ports:write,sessions:read    1 agent
observer   sessions:read,notes:read,activity:read  0 agents`}
            />
          </div>
        </div>
      </div>

      {/* Fleet Harbors */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">05</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Fleet Harbors</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Fleet agents share a common harbor automatically. Declare <code>harbor</code> in your{' '}
          <code>pd-fleet.yml</code> and all agents join it on startup:
        </p>
        <DocsCodeBlock
          language="bash"
          code={`fleet:
  name: my-project
  harbor: "{project}:fleet"   # All agents join this harbor

  agents:
    qa:
      identity: "{project}:fleet:qa"
      # ...`}
        />
        <p className="text-sm text-[var(--text-secondary)]">
          Query your fleet with <code>pd find &apos;my-project:fleet:*&apos;</code> to see all agents,
          or <code>pd harbors my-project:fleet members</code> for the full member list.
        </p>
      </div>

      {/* SDK Usage */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">06</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>
        </div>

        <DocsCodeBlock
          language="typescript"
          code={`import { PortDaddy } from 'port-daddy'

const pd = new PortDaddy()

// Create a harbor
await pd.harbors.create('reviewer', {
  capabilities: ['code:read', 'notes:write', 'sessions:read']
})

// Enter the harbor (declares intent, advisory in v1)
await pd.harbors.enter('reviewer')

// List harbors to see current agent scoping
const harbors = await pd.harbors.list()
harbors.forEach(h => {
  console.log(\`\${h.name}: \${h.capabilities.join(', ')}\`)
})`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Agent Salvage</div>
          <div className="text-sm text-[var(--text-muted)]">Crash recovery and work continuation for dead agents</div>
        </div>
        <Link
          to="/docs/features/salvage"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
