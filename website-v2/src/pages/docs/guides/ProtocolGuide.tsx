import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Mermaid } from '@/components/ui/Mermaid'
import { Workflow } from 'lucide-react'

const LIFECYCLE_CHART = `flowchart LR
  A[Client or Agent] -->|begin session| B[Port Daddy Daemon]
  B --> C[(SQLite state)]
  A -->|emit notes / claims / signals| B
  B -->|broadcast updates| D[Other clients]
  A -->|spawn or queue work| E[Fleet executor]
  E -->|status + artifacts| B
  F[Agent crash] -->|salvage claim| G[Replacement agent]
  G -->|resume state| B`

export default function ProtocolGuide() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Badge variant="teal">Guides</Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">Agent Protocol &amp; State</h1>
        <p className="text-lg text-[var(--text-secondary)] max-w-3xl">
          Port Daddy coordination is event-driven: session lifecycle, message flow, persisted state, and resumability are first-class protocol behavior.
        </p>
      </div>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-4">
        <div className="flex items-center gap-2">
          <Workflow size={16} className="text-[var(--brand-secondary)]" />
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Lifecycle Diagram</h2>
        </div>
        <figure className="space-y-2">
          <Mermaid chart={LIFECYCLE_CHART} />
          <figcaption className="text-xs text-center text-[var(--text-muted)]">
            Session begin, event emission, broadcast synchronization, and salvage-based continuation.
          </figcaption>
        </figure>
      </Surface>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">State Model</h2>
        <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
          <li>Session state is persisted and queryable; it survives process restarts.</li>
          <li>Notes and claims are immutable audit surfaces for recovery and attribution.</li>
          <li>Broadcast channels provide real-time fan-out to all interested clients.</li>
          <li>Salvage queue transfers ownership when an agent fails mid-run.</li>
        </ul>
      </Surface>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Event Handlers</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Model events as stable protocol hooks so agents and operators can react deterministically.
        </p>
        <CodeBlock language="typescript">{`type SessionEvent =
  | { type: 'session.start'; sessionId: string; agentId: string }
  | { type: 'session.note'; sessionId: string; noteId: number }
  | { type: 'file.claim'; path: string; owner: string }
  | { type: 'agent.crash'; agentId: string }
  | { type: 'salvage.claimed'; originalAgentId: string; replacementAgentId: string }

function onEvent(event: SessionEvent) {
  // publish to channels, trigger fleet actions, or request human approval
}`}</CodeBlock>
      </Surface>

      <div className="rounded-xl border-l-4 p-4" style={{ borderLeftColor: 'var(--status-info)', background: 'color-mix(in srgb, var(--status-info) 8%, var(--surface-raised))' }}>
        <p className="text-sm text-[var(--text-secondary)]">
          Treat event-handler coverage as product behavior: start/stop hooks, queue transitions, approval waits, and failure handoff should all be observable.
        </p>
      </div>
    </div>
  )
}
