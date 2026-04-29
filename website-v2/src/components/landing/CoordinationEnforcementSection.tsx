import { CheckCircle2, FileCheck2, GitCommit, LockKeyhole, NotebookTabs } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import {
  CommandBlock,
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
    detail: 'Agents begin a session, claim intended files or symbols, and leave notes before their local plan drifts from the repo.',
    icon: NotebookTabs,
  },
  {
    title: 'Commits can fail closed',
    detail: 'Coordination Guard checks staged files against active Port Daddy sessions and claims before a commit crosses the line.',
    icon: GitCommit,
  },
  {
    title: 'Recovery keeps the context',
    detail: 'If an agent dies, salvage preserves purpose, notes, claimed files, and handoff evidence for the next body.',
    icon: FileCheck2,
  },
] as const

export function CoordinationEnforcementSection() {
  return (
    <section id="coordination-enforcement" className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="wide">
            <SectionIntro
              eyebrow="Banner capability"
              title="Enforce agent coordination before the commit."
              description="Port Daddy is not just a dashboard. It gives every repo a coordination contract: sessions for intent, file claims for edit boundaries, locks for scarce work, tuples for shared facts, and a guard that can block uncoordinated commits."
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

          <SwissGridItem span="rail">
            <CommandBlock
              title="Guarded change"
              command={'pd begin "ship the auth fix"\npd session files add src/auth.ts\npd guard install --mode enforce\npd guard check --staged'}
              elevation="quiet"
              label="Terminal"
            />
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
