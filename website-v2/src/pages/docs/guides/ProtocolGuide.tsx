import { Mermaid } from '@/components/ui/Mermaid'
import {
  BracketLabel,
  DocsCodeBlock,
  DocsNoteCard,
  PanelBody,
  PanelList,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'

const LIFECYCLE_CHART = `flowchart LR
  Human["Human in Fleet Control Center"] -->|"approves scope, budget, risk"| Daemon["Port Daddy daemon"]
  Agent["Agent process"] -->|"begin, note, claim, publish"| Daemon
  Daemon --> State["SQLite state"]
  Daemon --> Console["Flow, Activity, Inbox, YAML"]
  Daemon --> Peers["Other agents"]
  Agent -->|"crash or timeout"| Salvage["Salvage queue"]
  Salvage -->|"claimed by replacement"| Agent2["Replacement agent"]`

const eventExample = `type SessionEvent =
  | { type: 'session.start'; sessionId: string; agentId: string }
  | { type: 'session.note'; sessionId: string; noteId: number }
  | { type: 'file.claim'; path: string; owner: string }
  | { type: 'human.approval.requested'; inboxId: string; risk: string }
  | { type: 'agent.crash'; agentId: string }
  | { type: 'salvage.claimed'; originalAgentId: string; replacementAgentId: string }`

export default function ProtocolGuide() {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="space-y-[var(--space-4)]">
        <BracketLabel>Guides</BracketLabel>
        <SectionIntro
          eyebrow="Protocol and state"
          title="The agent acts. The console keeps the work accountable."
          description="Port Daddy is not just a CLI wrapper. Agents write sessions, notes, claims, messages, and salvage records into a daemon-owned state layer. The human reads and approves that work in Fleet Control Center."
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-[20ch]"
          bodyClassName="max-w-[54rem]"
        />
      </div>

      <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--panel-gap)]">
        <BracketLabel>Lifecycle</BracketLabel>
        <PanelTitle as="h2" size="nav" className="max-w-none">One state model, two audiences.</PanelTitle>
        <PanelBody size="compact" className="max-w-[54rem]">
          Agents need fast commands and durable handoffs. Humans need Flow, Activity, Inbox, and YAML views that
          explain what happened without asking them to reverse-engineer a terminal scrollback.
        </PanelBody>
        <figure className="space-y-[var(--space-2)]">
          <Mermaid chart={LIFECYCLE_CHART} />
          <figcaption className="font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            Begin, notes, claims, approval, crash recovery, and replacement all write into the same daemon state.
          </figcaption>
        </figure>
      </SurfacePanel>

      <DocsNoteCard label="State model" title="What must survive process death." elevation="quiet" padding="compact" titleSize="nav">
        <PanelList
          items={[
            'Session state is persisted and queryable after terminal close.',
            'Notes and claims are immutable evidence for recovery and attribution.',
            'Channels carry agent-to-agent signals without hiding them from the operator.',
            'Fleet Control Center turns the same state into human-readable Flow, Activity, Inbox, and YAML surfaces.',
            'Salvage transfers abandoned work to a replacement instead of losing the context.',
          ]}
        />
      </DocsNoteCard>

      <DocsNoteCard label="Events" title="Event handlers are product behavior." elevation="quiet" padding="compact" titleSize="nav">
        <PanelBody size="compact" className="max-w-[54rem]">
          Start, stop, queue transitions, approvals, failure handoffs, and salvage claims are not background trivia.
          They are the things the human console must show and the agent runtime must write.
        </PanelBody>
        <DocsCodeBlock code={eventExample} language="typescript" label="Protocol shape" />
      </DocsNoteCard>
    </div>
  )
}
