import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function RadioFeature() {
  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <p className="font-mono text-[length:var(--type-meta-size)] font-bold uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
          Feature · Radio
        </p>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Swarm Radio
        </h1>
        <p className="text-lg text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Real-time messages between agents over named channels. One agent publishes to a channel
          and any agent listening on it reacts right away, instead of repeatedly checking for
          updates. This is a publish/subscribe (pub/sub) setup.
        </p>
      </div>

      {/* The Problem */}
      <div>
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">01</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">The Problem</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
          When multiple AI agents work on the same codebase, they need to communicate state
          changes in real time. Without a messaging layer, teams resort to:
        </p>
        <ul className="space-y-2 text-[var(--text-secondary)]">
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Polling files or APIs on a timer, wasting cycles and missing events</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>Writing coordination data to shared files with race conditions</span>
          </li>
          <li className="flex items-start gap-2">
            <AlertCircle size={16} className="text-[var(--error)] mt-1 shrink-0" />
            <span>No way to broadcast "build finished" or "tests passed" to all listeners</span>
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
          Swarm Radio uses named channels with Server-Sent Events (SSE) for real-time delivery.
          Any agent can publish a message to a channel, and every subscriber receives it instantly.
          Channels are created on first use and cleaned up automatically.
        </p>

        <DocsCodeBlock
          code={`# Publish a message to a channel
$ pd pub build-status "compilation complete"

# Subscribe to a channel (SSE stream)
$ pd sub build-status

# Watch a channel and run a command on each message
$ pd watch build-status --exec './run-tests.sh'`}
          output={`Listening on build-status...
[build-status] compilation complete
[build-status] tests started
[build-status] all 47 tests passed`}
        />
      </div>

      {/* Channel Architecture */}
      <div className="space-y-3">
        <div className="lw-sect-head flex items-baseline gap-[var(--space-3)]">
          <span className="font-mono text-[length:var(--type-meta-size)] font-bold text-[var(--brand-primary)]">03</span>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Channel Architecture</h2>
        </div>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Channels are lightweight, ephemeral, and scoped by name. Use structured naming
          to organize your message flows.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">build-status</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Build pipeline events</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">compile, lint, test results</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">deploy:staging</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Deployment notifications</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">started, succeeded, rolled back</p>
          </div>
          <div className="lw-stripe-card p-3">
            <code className="text-[var(--brand-primary)] font-mono">agent:sync</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">Agent coordination</p>
            <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)] mt-1">task claims, handoffs, done signals</p>
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
            <code className="font-mono text-[var(--brand-primary)]">pd pub &lt;channel&gt; &lt;message&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Publish a message to a channel. Fire-and-forget; returns immediately.</p>
            <DocsCodeBlock
              code={`$ pd pub build-status "all tests passed"
$ pd pub deploy:staging '{"version":"2.1.0","status":"live"}'`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd sub &lt;channel&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Subscribe to a channel via SSE. Streams messages in real time until interrupted.</p>
            <DocsCodeBlock
              code={`$ pd sub build-status`}
              output={`Listening on build-status...
[build-status] compilation complete
[build-status] all tests passed`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd watch &lt;channel&gt; --exec &lt;cmd&gt;</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">Subscribe to a channel and execute a command each time a message arrives. Reconnects automatically on disconnect.</p>
            <DocsCodeBlock
              code={`$ pd watch build-results --exec './analyze.sh'`}
              output={`Watching build-results...
[trigger] Running ./analyze.sh
[complete] Exit code 0`}
            />
          </div>

          <div className="border-l-[length:var(--lw-stripe)] border-[var(--brand-primary)] pl-4">
            <code className="font-mono text-[var(--brand-primary)]">pd channels</code>
            <p className="text-[var(--text-secondary)] text-sm mt-1 mb-2">List all active channels with subscriber counts and last message timestamp.</p>
            <DocsCodeBlock
              code={`$ pd channels`}
              output={`build-status    3 subscribers   2s ago
deploy:staging  1 subscriber    5m ago
agent:sync      2 subscribers   12s ago`}
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

// Publish a message
await pd.publish('build-status', 'all tests passed')

// Subscribe to a channel
const stream = pd.subscribe('build-status', (msg) => {
  console.log('Received:', msg)
})

// Clean up when done
stream.close()`}
        />
      </div>

      {/* Next */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--surface-base))] p-5">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Cryptographic Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">HMAC-signed capability namespaces for agent permissions</div>
        </div>
        <Link
          to="/docs/features/harbors"
          className="flex items-center gap-2 bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)]"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
