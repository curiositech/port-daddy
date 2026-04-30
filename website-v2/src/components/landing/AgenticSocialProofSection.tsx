import { AlertTriangle, CheckCircle2, FileCheck2, GitMerge, Mail, Quote, RadioTower } from 'lucide-react'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'

const coordinationReceipts = [
  {
    title: 'Overlap is visible before damage',
    detail: 'Active sessions and file claims show when two agents are near the same surface, so the next worker can narrow scope before conflict becomes lost work.',
    icon: AlertTriangle,
  },
  {
    title: 'Context survives the process',
    detail: 'A durable note can record the goal, evidence, tests, and remaining risk even after the model session or terminal exits.',
    icon: FileCheck2,
  },
  {
    title: 'Warnings reach the owner',
    detail: 'Inbox and scoped channel messages route a blocker or review request to the role that owns it, not to whoever happens to be reading chat.',
    icon: Mail,
  },
  {
    title: 'Recovery has evidence',
    detail: 'A future agent can read the claims, notes, and activity trail, then continue from recorded facts instead of reconstructing the argument from chat.',
    icon: CheckCircle2,
  },
] as const

const liveQuotes = [
  {
    name: 'Codex worker',
    agentId: 'session note + file claim',
    purpose: 'Before editing a shared surface.',
    source: 'Runtime receipt',
    quote:
      'The session note, file claim, and activity trail told me which surface was already active before I touched the code.',
  },
  {
    name: 'FleetBar operator',
    agentId: 'scoped handoff',
    purpose: 'While neighboring agent work was active.',
    source: 'Operator paraphrase',
    quote:
      'The useful thing was not that another agent existed. It was that I could see its scope, its handoff, and the exact surface I should avoid.',
  },
  {
    name: 'Guard preflight',
    agentId: 'claim + staged check',
    purpose: 'Before changing shared history.',
    source: 'Coordination proof',
    quote:
      'Port Daddy turned coordination from etiquette into evidence: named session, claimed files, visible notes, and a guard check before history changed.',
  },
] as const

const resolutionTimeline = [
  {
    title: 'Conflict becomes state',
    detail:
      'Port Daddy turns active sessions, claims, messages, and guard failures into inspectable project state instead of scattered chat memory.',
    icon: AlertTriangle,
  },
  {
    title: 'Ownership is explicit',
    detail:
      'Agents can declare what they are touching, leave evidence as they go, and release claims when the work is done.',
    icon: GitMerge,
  },
  {
    title: 'The operator gets a control plane',
    detail:
      'FleetBar and Fleet Control Center show the same runtime truth without making the operator infer state from terminal scrollback.',
    icon: RadioTower,
  },
  {
    title: 'The next worker inherits context',
    detail:
      'Notes, inbox messages, salvage records, and activity events let a future agent resume with evidence, not guesswork.',
    icon: FileCheck2,
  },
] as const

function CoordinationTracePanel() {
  return (
    <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
      <div className="flex items-center justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
        <PanelEyebrow>Live coordination trace</PanelEyebrow>
        <span className="border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-2 py-1 font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--brand-primary-foreground)]">
          visible
        </span>
      </div>
      <div className="grid gap-[var(--space-3)]">
        {[
          ['Session', 'auth-api-refactor'],
          ['Claimed surface', 'src/auth.ts + auth.test.ts'],
          ['Guard result', 'staged files covered'],
          ['Handoff', 'review requested'],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 border-b border-[var(--border-default)] pb-[var(--space-2)] last:border-b-0 last:pb-0 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <span className="font-sans text-[length:var(--type-meta-size)] font-medium uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
              {label}
            </span>
            <span className="font-mono text-[11px] font-black uppercase tracking-[0.12em] text-[var(--text-primary)]">
              {value}
            </span>
          </div>
        ))}
      </div>
    </SurfacePanel>
  )
}

function AgentQuoteCard({ item }: { item: (typeof liveQuotes)[number] }) {
  return (
    <figure className="relative m-0 grid min-h-full gap-[var(--space-4)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)]">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <PanelEyebrow>{item.source}</PanelEyebrow>
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
          <Quote size={18} />
        </span>
      </div>

      <blockquote className="m-0 border-l-4 border-[var(--brand-primary)] pl-[var(--space-4)] font-sans font-opsz-body text-[length:var(--type-panel-body-size)] font-medium leading-[var(--leading-body)] text-[var(--text-primary)]">
        &ldquo;{item.quote}&rdquo;
      </blockquote>

      <figcaption className="grid gap-[var(--space-2)] border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
        <div className="flex flex-wrap items-baseline gap-x-[var(--space-2)] gap-y-1">
          <cite className="not-italic">
            <PanelTitle as="span" size="nav" className="max-w-none">
              {item.name}
            </PanelTitle>
          </cite>
          <span className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {item.agentId}
          </span>
        </div>
        <PanelBody size="compact" className="max-w-none">
          {item.purpose}
        </PanelBody>
      </figcaption>
    </figure>
  )
}

export function AgenticSocialProofSection() {
  return (
    <section
      id="agentic-social-proof"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.95fr)_minmax(20rem,1.05fr)] lg:items-end">
          <SectionIntro
            eyebrow="Proof under pressure"
            title="This is what the layer adds when agents overlap."
            description="The useful proof is not a testimonial. It is what happens when multiple AI workers touch the same repo: Port Daddy exposes ownership, handoff evidence, guard state, and recovery context before coordination depends on someone remembering the last chat."
            titleAs="h2"
            titleSize="display"
            titleClassName="max-w-[14ch]"
            bodyClassName="max-w-[43rem]"
          />
          <CoordinationTracePanel />
        </div>

        <div className="mt-[var(--space-7)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
          <div className="grid gap-[var(--space-4)]">
            <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <source srcSet="/img/generated/agent-runtime-map.webp" type="image/webp" />
              <img
                src="/img/generated/agent-runtime-map.jpg"
                alt="Abstract map of local agents exchanging claims, notes, and handoffs"
                className="h-full min-h-[22rem] w-full object-cover"
                loading="lazy"
              />
            </picture>

            <div className="grid gap-[var(--space-3)]">
              {liveQuotes.map((item) => (
                <AgentQuoteCard key={`${item.name}-${item.agentId}`} item={item} />
              ))}
            </div>
          </div>

          <div className="grid gap-[var(--space-4)] sm:grid-cols-2">
            {coordinationReceipts.map((receipt, index) => {
              const Icon = receipt.icon
              return (
                <SurfacePanel key={receipt.title} elevation="quiet" padding="compact" className="grid content-start gap-[var(--space-4)]">
                  <div className="flex items-start justify-between gap-[var(--space-3)] border-b-2 border-[var(--border-strong)] pb-[var(--space-3)]">
                    <BracketLabel>{String(index + 1).padStart(2, '0')}</BracketLabel>
                    <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                      <Icon size={18} />
                    </span>
                  </div>
                  <PanelTitle as="h3" size="nav" className="max-w-none">
                    {receipt.title}
                  </PanelTitle>
                  <PanelBody size="compact" className="max-w-none">
                    {receipt.detail}
                  </PanelBody>
                </SurfacePanel>
              )
            })}
          </div>
        </div>

        <SurfacePanel tone="blue" className="mt-[var(--space-5)] grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
          <div className="grid content-start gap-[var(--space-3)]">
            <PanelEyebrow tone="primary">What this proves</PanelEyebrow>
            <PanelTitle as="h3" size="card" tone="primary" className="max-w-[14ch]">
              Multi-agent work needs a ledger.
            </PanelTitle>
            <PanelBody tone="primary" className="max-w-[38rem]">
              A serious agent platform needs more than launch buttons. It needs a durable ledger of ownership, warnings, decisions, spend, and recovery evidence that both agents and operators can trust.
            </PanelBody>
          </div>

          <div className="grid gap-[var(--space-3)]">
            {resolutionTimeline.map((step, index) => {
              const Icon = step.icon
              return (
                <div
                  key={step.title}
                  className="grid gap-[var(--space-3)] border border-[color:var(--brand-primary-foreground-subtle)] p-[var(--space-3)] md:grid-cols-[3.25rem_minmax(0,1fr)]"
                >
                  <div className="flex items-center justify-between gap-[var(--space-3)] md:block">
                    <BracketLabel className="border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)]">
                      {String(index + 1).padStart(2, '0')}
                    </BracketLabel>
                    <span className="inline-flex h-10 w-10 items-center justify-center border border-[color:var(--brand-primary-foreground-subtle)] text-[var(--brand-primary-foreground)] md:mt-[var(--space-3)]">
                      <Icon size={17} />
                    </span>
                  </div>
                  <div className="grid gap-[var(--space-2)]">
                    <PanelTitle as="h4" size="nav" tone="primary" className="max-w-none">
                      {step.title}
                    </PanelTitle>
                    <PanelBody tone="primary" size="compact" className="max-w-none">
                      {step.detail}
                    </PanelBody>
                  </div>
                </div>
              )
            })}
          </div>
        </SurfacePanel>
      </PageContainer>
    </section>
  )
}
