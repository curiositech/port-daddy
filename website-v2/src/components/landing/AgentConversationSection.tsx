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
    title: 'Notes become recoverable memory',
    icon: MessageSquareText,
    description: 'Session notes keep intent, evidence, tests, remaining risk, and the last truthful handoff outside the model context window that produced them.',
    appEvidence: 'A new agent can resume from the note trail without asking the human to reconstruct state.',
  },
  {
    id: 'claims',
    label: '02',
    title: 'Claims make ownership explicit',
    icon: ShieldCheck,
    description: 'File and region claims turn parallel editing into visible intent. Agents can see who is already near a surface, narrow scope, or escalate before edits collide.',
    appEvidence: 'Touched files and owners appear before another agent starts writing.',
  },
  {
    id: 'radio',
    label: '03',
    title: 'Channels carry machine-readable signals',
    icon: RadioTower,
    description: 'Scoped channels carry test failures, contention, readiness gaps, and drift warnings without turning the human into the message bus.',
    appEvidence: 'Warnings land in Activity, channels, and actor inboxes with project scope attached.',
  },
  {
    id: 'actors',
    label: '04',
    title: 'Actors keep responsibility addressable',
    icon: Waypoints,
    description: (
      <>
        <span className="block">
          Durable actors are named responsibility holders with inboxes. Agents can ask them for
          decisions, warnings, or ground truth after the original shell session exits.
        </span>
        <span className="mt-[var(--space-2)] block">
          <RoleTerm role="coxswain" tooltipAlign="end">Coxswain</RoleTerm>: claims and locks.{' '}
          <RoleTerm role="lookout">Lookout</RoleTerm>: docs and product truth.{' '}
          <RoleTerm role="navigator">Navigator</RoleTerm>: roadmap and recovery truth.{' '}
          <RoleTerm role="quartermaster">Quartermaster</RoleTerm>: budgets and backend pressure.
        </span>
      </>
    ),
    appEvidence: 'Ownership stays addressable: the inbox is still there when the shell that registered it isn't.',
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
                eyebrow="Shared-state substrate"
                title="Coordination is state agents can read."
                description="Schedulers decide what runs. Port Daddy gives the running agents a durable coordination plane: notes, claims, scoped channels, actor inboxes, tuple-backed facts, and salvage records that make work inspectable across models, terminals, and crashes."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[12ch]"
              />
              <SurfacePanel tone="blue" padding="compact" elevation="quiet">
                <PanelEyebrow tone="primary">Why AI tooling teams care</PanelEyebrow>
                <PanelBody tone="primary" size="compact" className="mt-[var(--space-2)] max-w-none">
                  Agent quality improves when the environment can prove ownership, state, budget, and recovery instead of relying on prompt discipline alone.
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
