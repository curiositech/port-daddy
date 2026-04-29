import { CheckCircle2, FileCheck2, GitCommit, LockKeyhole, MonitorCheck, NotebookTabs } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
} from '@/components/site/primitives'

const outcomes = [
  {
    title: 'Every change has an owner',
    detail: 'Agents work in terminals, claim intended files or symbols, and leave notes before their local plan drifts from the repo.',
    icon: NotebookTabs,
  },
  {
    title: 'Humans steer from the app',
    detail: 'FleetBar and Fleet Control Center show project state, readiness, agents, resources, and recovery without making the operator parse shell ceremony.',
    icon: MonitorCheck,
  },
  {
    title: 'Terminal proof includes output',
    detail: 'When the website shows a terminal, it should show the command and the daemon response, not a stack of inputs pretending to be evidence.',
    icon: GitCommit,
  },
  {
    title: 'Recovery keeps the context',
    detail: 'If an agent dies, salvage preserves purpose, notes, claimed files, and handoff evidence for the next agent.',
    icon: FileCheck2,
  },
] as const

export function CoordinationEnforcementSection() {
  return (
    <section id="coordination-enforcement" className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <SectionIntro
              eyebrow="Operator control"
              title="Agents use the terminal. Humans use the GUI."
              description="Port Daddy gives each repo a coordination contract, but the public homepage should not ask a human to admire a command checklist. The app surface is where operators see readiness, claims, live agents, resources, handoffs, and recovery state."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[13ch]"
              bodyClassName="max-w-[44rem]"
            />
            <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <a href="/docs/best-practices/coordination-discipline">
                  <CheckCircle2 size={16} />
                  Coordination discipline
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="/docs/cli/with-lock">
                  <LockKeyhole size={16} />
                  Lock reference
                </a>
              </Button>
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
              <div className="grid gap-[var(--space-3)] sm:grid-cols-[3rem_minmax(0,1fr)] sm:items-start">
                <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                  <MonitorCheck size={18} />
                </span>
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>FleetBar and Fleet Control Center</PanelEyebrow>
                  <PanelTitle as="h3" size="nav" className="max-w-none">
                    The human view is the live control plane.
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    Use terminal evidence for agent work. Use the GUI for operator judgment.
                  </PanelBody>
                </div>
              </div>
              <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
                <source srcSet="/img/app-screens/fleet-flow-dark.png" media="(prefers-color-scheme: dark)" />
                <img
                  src="/img/app-screens/fleet-flow-light.png"
                  alt="Fleet Control Center showing live agent coordination in the GUI"
                  className="aspect-[16/10] w-full object-cover object-left-top"
                  loading="lazy"
                />
              </picture>
            </SurfacePanel>
          </SwissGridItem>
        </SwissGrid>

        <div className="mt-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <source srcSet="/img/generated/coordination-guard.webp" type="image/webp" />
            <img
              src="/img/generated/coordination-guard.jpg"
              alt="Abstract coordination guard diagram showing claims, locks, notes, and guard rails"
              className="h-full min-h-[18rem] w-full object-cover"
              loading="lazy"
            />
          </picture>

          <div className="grid gap-[var(--space-4)]">
            {outcomes.map((outcome) => (
              <SurfacePanel key={outcome.title} elevation="quiet" padding="compact" className="grid gap-[var(--space-3)] md:grid-cols-[3rem_minmax(0,1fr)]">
                <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                  <outcome.icon size={18} />
                </span>
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>What you get</PanelEyebrow>
                  <PanelTitle as="h3" size="nav" className="max-w-none">
                    {outcome.title}
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {outcome.detail}
                  </PanelBody>
                </div>
              </SurfacePanel>
            ))}
          </div>
        </div>
      </PageContainer>
    </section>
  )
}
