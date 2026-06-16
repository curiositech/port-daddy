import type { ReactNode } from 'react'
import { MessageSquareText, RadioTower, ShieldCheck, Waypoints, type LucideIcon } from 'lucide-react'
import {
  PageContainer,
  PanelBody,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'
import { RoleTerm } from '@/components/site/RoleTerm'

type AgentSignal = {
  id: string
  title: string
  icon: LucideIcon
  description: ReactNode
  inApp: string
}

const AGENT_SIGNALS: AgentSignal[] = [
  {
    id: 'notes',
    title: 'Notes the next agent can read',
    icon: MessageSquareText,
    description:
      'When an agent stops, it writes down what it was doing, what it proved, and what is left. The note stays after the agent and its chat history are gone.',
    inApp: 'A new agent reads the note trail and picks up where the last one stopped. You do not have to re-explain the work.',
  },
  {
    id: 'claims',
    title: 'Who is editing what, in the open',
    icon: ShieldCheck,
    description:
      'Before an agent edits a file, it claims the file so others can see it. When two agents reach for the same file, the second one notices and backs off instead of overwriting the first.',
    inApp: 'You can see which files each agent has claimed before anyone starts writing.',
  },
  {
    id: 'radio',
    title: 'Agents warn each other directly',
    icon: RadioTower,
    description:
      'Agents post short messages other agents can act on: a test broke, two of us want the same file, this is not ready yet. The warnings go to the other agents, not to you.',
    inApp: 'Warnings show up in the activity feed, tagged with the project they came from.',
  },
  {
    id: 'actors',
    title: 'Named roles that keep an inbox',
    icon: Waypoints,
    description: (
      <>
        <span className="block">
          Some duties outlive any single agent. Port Daddy keeps a few standing roles, each with its
          own inbox and history. An agent can ask a role a question and get an answer even after the
          agent that set things up has exited.
        </span>
        <span className="mt-[var(--space-2)] block">
          Who owns the files (<RoleTerm role="coxswain" tooltipAlign="end">Coxswain</RoleTerm>) · who keeps the docs honest
          (<RoleTerm role="lookout">Lookout</RoleTerm>) · who tracks the roadmap and recovery
          (<RoleTerm role="navigator">Navigator</RoleTerm>) · who watches the budget
          (<RoleTerm role="quartermaster">Quartermaster</RoleTerm>).
        </span>
      </>
    ),
    inApp: 'These roles keep their inbox and history even when no agent is currently attached to them.',
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
                eyebrow="Shared memory"
                title="Coordination is just shared memory agents can read."
                description="A scheduler decides what runs next. Port Daddy is the shared memory the running agents read from and write to: notes they leave each other, who is editing which file, warnings they send directly, a small store of facts they can look up, and the records left behind by a crashed agent. It holds up across different models, different terminals, and crashes."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[16ch]"
              />
              <SurfacePanel tone="blue" padding="compact" elevation="quiet">
                <PanelBody tone="primary" size="compact" className="max-w-none">
                  Agents do better work when the workspace can show ownership, state, budget, and what a crashed agent left behind, instead of hoping every prompt remembers to.
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
                      <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--text-primary)]">
                        <Icon size={18} />
                      </span>
                    </div>
                    <div className="grid gap-[var(--space-3)]">
                      <PanelTitle as="h3" size="card" className="max-w-[24ch]">
                        {signal.title}
                      </PanelTitle>
                      <PanelBody className="max-w-[42rem]">
                        {signal.description}
                      </PanelBody>
                    </div>
                    <div className="grid min-w-0 gap-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)] md:col-start-2">
                      <PanelBody size="compact" className="max-w-[42rem] text-[var(--text-secondary)]">
                        <span className="font-semibold text-[var(--text-primary)]">In the app: </span>
                        {signal.inApp}
                      </PanelBody>
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
