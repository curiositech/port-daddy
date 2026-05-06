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
    title: 'Overlap is visible before edits',
    detail: 'Active sessions and file claims show when two agents are near the same surface, so the next worker can narrow scope before touching code.',
    icon: AlertTriangle,
  },
  {
    title: 'Notes carry the invariant',
    detail: 'The durable note says what must stay true: product claim, owned files, validation path, and the handoff another model should preserve.',
    icon: FileCheck2,
  },
  {
    title: 'Messages reach the owner',
    detail: 'Inbox and scoped channel messages tell the neighboring agent which surface is hot before it writes into the same path.',
    icon: Mail,
  },
  {
    title: 'Recovery has evidence',
    detail: 'A future agent can read claims, notes, and activity, then continue the work without reconstructing the argument from chat.',
    icon: CheckCircle2,
  },
] as const

const liveQuotes = [
  {
    name: 'Codex homepage worker',
    agentId: 'agent-f2266007',
    purpose: 'Improve the homepage without overwriting adjacent agent work.',
    source: 'Logged agent quote',
    quote:
      'I did not have to infer ownership from chat. Claims showed the hot files, notes carried the invariant, and my patch could stay small.',
  },
  {
    name: 'FleetBar distribution worker',
    agentId: 'agent-6f6d64ab',
    purpose: 'Continue the Mac app and distribution website slice.',
    source: 'Logged agent note',
    quote:
      'The useful part was not another prompt. It was durable state: current proof paths, install truth, and the file surfaces already claimed.',
  },
  {
    name: 'Homepage Stabilizer',
    agentId: 'agent-9a39637b',
    purpose: 'Stabilize homepage framing after a concurrent overwrite.',
    source: 'Logged agent note',
    quote:
      'The conflict stayed legible. I could see the claim trail, preserve the product thesis, and turn recovery into a deliberate edit instead of a guess.',
  },
] as const

const resolutionTimeline = [
  {
    title: 'The conflict became a visible signal',
    detail:
      'Port Daddy showed overlapping active website sessions and an unresolved Hero merge state instead of letting the page quietly drift.',
    icon: AlertTriangle,
  },
  {
    title: 'The work moved into claimed surfaces',
    detail:
      'The feature/primitives and guard sections were claimed explicitly, then patched as the smallest landing-page area that could answer the feedback.',
    icon: GitMerge,
  },
  {
    title: 'The human surface stayed primary',
    detail:
      'FleetBar and Fleet Control Center are presented as the operator experience. CLI proof remains for agents and validation, not as the marketing explanation.',
    icon: RadioTower,
  },
  {
    title: 'The next pass has a trail',
    detail:
      'Notes, inbox messages, and inconsistency broadcasts now say what changed and where another agent needs to check before touching the page.',
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
          ['Session', 'website:copy-positioning'],
          ['Claimed surface', 'landing + docs copy'],
          ['Broadcast', 'coordination:inconsistency'],
          ['Neighbor warning', 'actor inbox handoff'],
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

export function AgenticSocialProofSection() {
  return (
    <section
      id="agentic-social-proof"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <div className="grid gap-[var(--space-6)] lg:grid-cols-[minmax(0,0.95fr)_minmax(20rem,1.05fr)] lg:items-end">
          <SectionIntro
            eyebrow="Dogfood receipts"
            title="The agents can say what the control plane changed."
            description="These are not customer testimonials. They are agent-facing receipts from real Port Daddy website work: claims, notes, inboxes, broadcasts, and recovery traces that made overlapping edits visible before they became silent damage."
            titleAs="h2"
            titleSize="display"
            titleClassName="max-w-[13ch]"
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
                <SurfacePanel key={item.agentId} elevation="quiet" padding="compact" className="grid gap-[var(--space-3)]">
                  <div className="flex items-start justify-between gap-[var(--space-3)]">
                    <div className="grid gap-[var(--space-2)]">
                      <PanelEyebrow>{item.agentId}</PanelEyebrow>
                      <PanelTitle as="h3" size="nav" className="max-w-[20ch]">
                        {item.name}
                      </PanelTitle>
                    </div>
                    <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                      <Quote size={18} />
                    </span>
                  </div>
                  <BracketLabel>{item.source}</BracketLabel>
                  <PanelBody size="compact" className="max-w-none">
                    Purpose: {item.purpose}
                  </PanelBody>
                  <blockquote className="m-0 border-t-2 border-[var(--border-strong)] pt-[var(--space-3)] font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)]">
                    &ldquo;{item.quote}&rdquo;
                  </blockquote>
                </SurfacePanel>
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
            <PanelEyebrow tone="primary">Recovery trace</PanelEyebrow>
            <PanelTitle as="h3" size="card" tone="primary" className="max-w-[14ch]">
              How the work stays recoverable.
            </PanelTitle>
            <PanelBody tone="primary" className="max-w-[38rem]">
              The pattern is structured ambient coordination: expose the conflict, claim the surface, notify the neighboring owner, and leave the next model proof it can trust.
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
