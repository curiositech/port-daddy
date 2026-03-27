import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

export default function RadioFeature() {
  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="teal">Feature</Badge>
          <Badge variant="success">Core</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight">
          Swarm Radio
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed max-w-3xl">
          Real-time pub/sub messaging between agents via named channels. Fire-and-forget
          publishing with SSE subscriptions means agents react to events, not poll for them.
        </p>
      </div>

      {/* The Problem */}
      <div className="p-6 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
        <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-4">The Problem</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
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
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">How It Works</h2>
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
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Channel Architecture</h2>
        <p className="text-[var(--text-secondary)] leading-relaxed">
          Channels are lightweight, ephemeral, and scoped by name. Use structured naming
          to organize your message flows.
        </p>

        <div className="grid sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">build-status</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Build pipeline events</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">compile, lint, test results</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">deploy:staging</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Deployment notifications</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">started, succeeded, rolled back</p>
          </div>
          <div className="p-4 rounded-lg bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <code className="text-[var(--brand-primary)] font-mono">agent:sync</code>
            <p className="text-sm text-[var(--text-muted)] mt-2">Agent coordination</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">task claims, handoffs, done signals</p>
          </div>
        </div>
      </div>

      {/* CLI Commands */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">CLI Commands</h2>

        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd pub &lt;channel&gt; &lt;message&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Publish a message to a channel. Fire-and-forget; returns immediately.</p>
            <DocsCodeBlock
              code={`$ pd pub build-status "all tests passed"
$ pd pub deploy:staging '{"version":"2.1.0","status":"live"}'`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd sub &lt;channel&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Subscribe to a channel via SSE. Streams messages in real time until interrupted.</p>
            <DocsCodeBlock
              code={`$ pd sub build-status`}
              output={`Listening on build-status...
[build-status] compilation complete
[build-status] all tests passed`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd watch &lt;channel&gt; --exec &lt;cmd&gt;</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">Subscribe to a channel and execute a command each time a message arrives. Reconnects automatically on disconnect.</p>
            <DocsCodeBlock
              code={`$ pd watch build-results --exec './analyze.sh'`}
              output={`Watching build-results...
[trigger] Running ./analyze.sh
[complete] Exit code 0`}
            />
          </div>

          <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
            <div className="flex items-center gap-2 mb-2">
              <code className="text-lg font-mono text-[var(--brand-primary)]">pd channels</code>
            </div>
            <p className="text-[var(--text-secondary)] mb-3">List all active channels with subscriber counts and last message timestamp.</p>
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
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">SDK Usage</h2>

        <div className="p-5 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)]">
          <div className="text-sm font-medium text-[var(--text-muted)] mb-3">TypeScript</div>
          <DocsCodeBlock
            language="typescript"
            code={`import { PortDaddy } from '@port-daddy/sdk'

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
      </div>

      {/* Next */}
      <div className="flex items-center justify-between p-6 rounded-xl bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent border border-[var(--brand-primary)]/20">
        <div>
          <div className="text-sm text-[var(--text-muted)] mb-1">Next Feature</div>
          <div className="font-semibold text-[var(--text-primary)]">Cryptographic Harbors</div>
          <div className="text-sm text-[var(--text-muted)]">HMAC-signed capability namespaces for agent permissions</div>
        </div>
        <Link
          to="/docs/features/harbors"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium hover:bg-[var(--brand-primary)] transition-colors"
        >
          Learn More
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  )
}
