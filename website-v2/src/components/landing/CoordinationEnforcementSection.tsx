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
    title: 'Parallel work without invisible collisions',
    detail: 'Agents claim files or symbols before editing, so another agent can see ownership and choose a safer path instead of overwriting nearby work.',
    icon: NotebookTabs,
  },
  {
    title: 'One operator view for the repo',
    detail: 'FleetBar and Fleet Control Center show live agents, touched files, backend readiness, resource pressure, budget posture, and recovery state together.',
    icon: MonitorCheck,
  },
  {
    title: 'Launch decisions use real readiness',
    detail: 'Before more automation starts, Port Daddy exposes missing auth, unavailable models, telemetry gaps, spend limits, and machine pressure.',
    icon: GitCommit,
  },
  {
    title: 'Agent failure becomes a queue',
    detail: 'If a process dies, salvage preserves purpose, notes, claims, and handoff evidence so the next agent can continue from facts.',
    icon: FileCheck2,
  },
] as const

const guardModes = [
  'Observe',
  'Enforce',
  'Check staged',
  'Claim files',
] as const

const statePrimitives = [
  ['Session', 'who is working, why, and from which repo context'],
  ['Ownership', 'claimed files, symbols, locks, and contested surfaces'],
  ['Runtime', 'backend readiness, budget posture, and machine pressure'],
  ['Recovery', 'notes, handoffs, salvage records, and remaining risk'],
] as const

function SharedStatePanel() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
      <div className="grid gap-[var(--space-2)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
        <PanelEyebrow>Shared state means</PanelEyebrow>
        <PanelBody size="compact" className="max-w-[42rem]">
          A common project ledger that agents can update and the operator can inspect before another worker starts, spends, edits, or commits.
        </PanelBody>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {statePrimitives.map(([label, detail]) => (
          <div key={label} className="grid gap-1 border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)]">
            <span className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--brand-primary)]">
              {label}
            </span>
            <span className="text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
              {detail}
            </span>
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

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
          The guard compares staged files with the active session and claims. When enforcement is on, an uncoordinated commit fails before it becomes repo history.
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
          ['Active session', 'auth-api-refactor'],
          ['Claim coverage', 'src/auth.ts + tests'],
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
          A coordination convention is useful only if agents and operators can see the same rule at the moment a change is about to ship.
        </PanelBody>
      </div>
    </SurfacePanel>
  )
}

export function CoordinationEnforcementSection() {
  return (
    <section id="coordination-enforcement" className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-raised)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]">
      <PageContainer width="wide">
        <SwissGrid className="items-start gap-y-[var(--space-5)]">
          <SwissGridItem span="wide">
            <SectionIntro
              eyebrow="Why it exists"
              title="Agent orchestration needs shared state."
              description="Modern coding agents can write code, but they do not automatically agree on ownership, context, budget, or recovery. Port Daddy supplies the local state layer around them: what is running, what each agent owns, what changed, and what is safe to do next."
              titleAs="h2"
              titleSize="display"
              titleClassName="max-w-[22ch]"
              bodyClassName="max-w-[48rem]"
            />
            <div className="mt-[var(--space-5)] flex flex-wrap gap-[var(--space-3)]">
              <Button asChild variant="primary" size="lg">
                <a href="/docs/best-practices/coordination-discipline">
                  <CheckCircle2 size={16} />
                  Coordination model
                </a>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <a href="/docs/cli/with-lock">
                  <LockKeyhole size={16} />
                  Guard reference
                </a>
              </Button>
            </div>
          </SwissGridItem>

          <SwissGridItem span="narrow">
            <SharedStatePanel />
          </SwissGridItem>
        </SwissGrid>

        <div className="mt-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.95fr)_minmax(22rem,0.72fr)]">
          <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-base)]">
            <source srcSet="/img/generated/coordination-guard.webp" type="image/webp" />
            <img
              src="/img/generated/coordination-guard.jpg"
              alt="Abstract coordination guard diagram showing claims, locks, notes, and guard rails"
              className="h-full min-h-[18rem] w-full object-cover"
              loading="lazy"
            />
          </picture>

          <GuardControlMock />
        </div>

        <div className="mt-[var(--space-5)] grid gap-[var(--space-4)] md:grid-cols-2 xl:grid-cols-4">
          {outcomes.map((outcome) => (
            <SurfacePanel key={outcome.title} elevation="quiet" padding="compact" className="grid content-start gap-[var(--space-3)]">
              <div className="flex items-start justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                <PanelEyebrow>What you get</PanelEyebrow>
                <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                  <outcome.icon size={18} />
                </span>
              </div>
              <PanelTitle as="h3" size="nav" className="max-w-none">
                {outcome.title}
              </PanelTitle>
              <PanelBody size="compact" className="max-w-none">
                {outcome.detail}
              </PanelBody>
            </SurfacePanel>
          ))}
        </div>
      </PageContainer>
    </section>
  )
}
