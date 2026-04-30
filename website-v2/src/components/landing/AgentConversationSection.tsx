import type { ReactNode } from 'react'
import { MessageSquareText, RadioTower, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'

type AgentSignal = {
  id: string
  label: string
  title: string
  icon: LucideIcon
  description: ReactNode
  appEvidence: string
}

const AGENT_SIGNALS: AgentSignal[] = [
  {
    id: 'notes',
    label: '01',
    title: 'Durable task memory',
    icon: MessageSquareText,
    description: 'Agents can write intent, decisions, validation, and remaining risk into a session timeline. The next tool reads the same context instead of asking the developer to reconstruct it.',
    appEvidence: 'The notes timeline shows scope, evidence, and handoff status.',
  },
  {
    id: 'claims',
    label: '02',
    title: 'Edit ownership',
    icon: ShieldCheck,
    description: 'File and region claims make parallel editing explicit. Agents can see who is already working on a surface, choose a smaller route, or escalate before product truth drifts.',
    appEvidence: 'Touched files and owners appear before another agent edits.',
  },
  {
    id: 'radio',
    label: '03',
    title: 'Machine-readable signals',
    icon: RadioTower,
    description: 'Scoped channels and tuples carry facts between tools: tests failed, a file is hot, a backend is blocked, or a handoff is ready. The operator can inspect the stream without becoming the message bus.',
    appEvidence: 'Warnings land in Activity, Channels, and actor inboxes.',
  },
  {
    id: 'actors',
    label: '04',
    title: 'Named responsibilities',
    icon: Waypoints,
    description: (
      <>
        <span className="block">
          Durable actors are named responsibility holders with inboxes. A fleet can route ownership,
          warnings, or review requests to a role instead of a disappearing process.
        </span>
        <span className="mt-[var(--space-2)] block">
          <RoleTerm role="coxswain" tooltipAlign="end">Coxswain</RoleTerm>: claims and locks.{' '}
          <RoleTerm role="lookout">Lookout</RoleTerm>: docs and product truth.{' '}
          <RoleTerm role="navigator">Navigator</RoleTerm>: roadmap and recovery truth.{' '}
          <RoleTerm role="quartermaster">Quartermaster</RoleTerm>: budgets and backend pressure.
        </span>
      </>
    ),
    appEvidence: 'Actor inboxes keep responsibility visible after a shell exits.',
  },
]

export function AgentConversationSection() {
  return (
    <section id="agent-radio" className="border-t-2 border-[var(--border-strong)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <SectionIntro
                eyebrow="Agent substrate"
                title="A repo-native API for agent teamwork."
                description="Instead of asking every agent to share one chat or remember hidden terminal state, Port Daddy gives them durable coordination APIs they can read and write: notes, claims, locks, scoped channels, tuples, inboxes, and salvage records."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[13ch]"
              />
              <SurfacePanel tone="blue" padding="compact" elevation="quiet">
                <PanelEyebrow tone="primary">Why engineers care</PanelEyebrow>
                <PanelBody tone="primary" size="compact" className="mt-[var(--space-2)] max-w-none">
                  The product value is not another chat UI. It is a local coordination substrate that existing AI tools can use while the operator keeps the full audit trail.
                </PanelBody>
              </SurfacePanel>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-4)]">
              {AGENT_SIGNALS.map((signal) => {
                const Icon = signal.icon
                return (
                  <article
                    key={signal.id}
                    className="grid gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-4)] md:grid-cols-[4rem_minmax(0,1fr)]"
                  >
                    <div className="flex items-center justify-between gap-[var(--space-3)] md:block">
                      <span className="font-mono text-[length:var(--type-panel-title-nav-size)] font-black text-[var(--brand-primary)]">
                        {signal.label}
                      </span>
                      <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)] md:mt-[var(--space-3)]">
                        <Icon size={18} />
                      </span>
                    </div>
                    <div className="grid gap-[var(--space-3)]">
                      <PanelTitle as="h3" size="card" className="max-w-[17ch]">
                        {signal.title}
                      </PanelTitle>
                      <PanelBody className="max-w-[42rem]">
                        {signal.description}
                      </PanelBody>
                    </div>
                    <div className="grid min-w-0 gap-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)] md:col-start-2">
                      <BracketLabel>App evidence</BracketLabel>
                      <div className="block min-w-0 border border-[var(--border-default)] bg-[color:var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-panel-body-compact-size)] font-bold leading-[var(--leading-body-compact)] text-[var(--brand-primary)]">
                        {signal.appEvidence}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
