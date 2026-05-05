import { CheckCircle2, FileCheck2, GitCommit, LockKeyhole, MonitorCheck, MonitorCog, NotebookTabs, ShieldCheck } from 'lucide-react'
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

const guardModes = [
  'Observe',
  'Enforce',
  'Check staged',
  'Claim files',
] as const

function GuardControlMock() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
        <div className="inline-flex items-center gap-[var(--space-2)]">
          <MonitorCog size={17} className="text-[var(--brand-primary)]" />
          <PanelEyebrow>FleetBar control</PanelEyebrow>
        </div>
        <span className="border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--brand-primary-foreground)]">
          Guard on
        </span>
      </div>

      <div className="grid gap-[var(--space-3)]">
        <PanelTitle as="h3" size="nav" className="max-w-none">
          Coordination Guard
        </PanelTitle>
        <PanelBody size="compact" className="max-w-none">
          Humans do not need to remember the shell ceremony. FleetBar shows the guard state, lets an operator switch from observe to enforce, checks staged files, and points agents at the files that need claims.
        </PanelBody>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {guardModes.map((mode) => (
          <button
            key={mode}
            type="button"
            className={[
              'border-2 border-[var(--border-strong)] px-3 py-2 text-left font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]',
              mode === 'Enforce'
                ? 'bg-[var(--text-primary)] text-[var(--text-inverse)]'
                : 'bg-[var(--surface-base)] text-[var(--text-primary)]',
            ].join(' ')}
          >
            {mode}
          </button>
        ))}
      </div>

      <div className="grid gap-2 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
        {[
          ['Active session', 'website:landing-reconcile'],
          ['Claim coverage', '7 landing files covered'],
          ['Commit posture', 'fail closed on mismatch'],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-default)] pb-2 last:border-b-0 last:pb-0">
            <span className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
              {label}
            </span>
            <span className="text-right font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--brand-primary)]">
              {value}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-3)]">
        <div className="inline-flex items-center gap-[var(--space-2)]">
          <ShieldCheck size={16} className="text-[var(--brand-primary)]" />
          <PanelEyebrow>Why it matters</PanelEyebrow>
        </div>
        <PanelBody size="compact" className="max-w-none">
          The UI makes the rule obvious before the commit: every staged file should belong to an active session, and every exception should be visible enough for a human to decide.
        </PanelBody>
      </div>
    </SurfacePanel>
  )
}

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

          <SwissGridItem span="rail">
            <GuardControlMock />
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
