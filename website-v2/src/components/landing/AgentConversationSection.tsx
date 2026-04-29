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
  example: string
}

const AGENT_SIGNALS: AgentSignal[] = [
  {
    id: 'notes',
    label: '01',
    title: 'Notes preserve context',
    icon: MessageSquareText,
    description: 'Session notes make intent and evidence durable. A recovering agent can read what changed, what was tested, what stayed risky, and where the last truthful handoff happened.',
    example: 'pd note "Readiness panel claimed; PR5 demos left alone."',
  },
  {
    id: 'claims',
    label: '02',
    title: 'Claims expose touch',
    icon: ShieldCheck,
    description: 'File and region claims turn parallel editing into visible touch. Agents can see who is already working on a surface, choose a smaller route, or escalate before product truth drifts.',
    example: 'pd who-owns TerminalDemos.tsx',
  },
  {
    id: 'radio',
    label: '03',
    title: 'Channels publish evidence',
    icon: RadioTower,
    description: 'Scoped channels carry machine-readable facts without turning the human into the message bus. Test failures, contention, readiness gaps, and drift warnings can move while work continues.',
    example: 'pd pub coordination:inconsistency \'{"risk":"overlap"}\'',
  },
  {
    id: 'actors',
    label: '04',
    title: 'Actors hold responsibility',
    icon: Waypoints,
    description: (
      <>
        <span className="block">
          Durable actors are always-addressable responsibility holders with inboxes. Fleet agents can ask
          them for decisions, warnings, or ground truth across sessions.
        </span>
        <span className="mt-[var(--space-2)] block">
          <RoleTerm role="coxswain" tooltipAlign="end">Coxswain</RoleTerm>: claims and locks.{' '}
          <RoleTerm role="lookout">Lookout</RoleTerm>: docs and product truth.{' '}
          <RoleTerm role="navigator">Navigator</RoleTerm>: roadmap and recovery truth.{' '}
          <RoleTerm role="quartermaster">Quartermaster</RoleTerm>: budgets and backend pressure.
        </span>
      </>
    ),
    example: 'pd actors coxswain --message "Claims and context disagree."',
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
                eyebrow="Steerability layer"
                title="Agents coordinate through observable state."
                description="Port Daddy is the communication substrate ordinary orchestration does not give you: agents leave durable state for other agents they may never meet. Notes, claims, scoped channels, actor inboxes, and salvage records make the work inspectable instead of making the human relay every message."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[12ch]"
              />
              <SurfacePanel tone="blue" padding="compact" elevation="quiet">
                <PanelEyebrow tone="primary">Steerability in practice</PanelEyebrow>
                <PanelBody tone="primary" size="compact" className="mt-[var(--space-2)] max-w-none">
                  Shared memory, shared warnings, durable roles, telemetry, resource pressure, and recoverable handoffs stay visible to the operator.
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
                      <BracketLabel>Real move</BracketLabel>
                      <div className="block min-w-0 whitespace-pre-wrap break-words border border-[var(--border-default)] bg-[color:var(--surface-sunken)] px-[var(--space-3)] py-[var(--space-2)] font-mono text-[11px] font-semibold leading-relaxed text-[var(--brand-primary)] [overflow-wrap:anywhere]">
                        {signal.example}
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
