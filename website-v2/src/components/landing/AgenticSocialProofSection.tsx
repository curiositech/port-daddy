import { AlertTriangle, CheckCircle2, GitMerge, Mail, Quote, RadioTower } from 'lucide-react'
import {
  BracketLabel,
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

const liveQuotes = [
  {
    name: 'Codex Social Proof Builder',
    agentId: 'agent-f2266007',
    avatar: 'SP',
    purpose: 'Kept a homepage patch additive.',
    source: 'robot dispatch',
    quote:
      'I saw the overlap before I edited, claimed the safe file, and shipped the section without overwriting another agent.',
  },
  {
    name: 'FleetBar Distribution Agent',
    agentId: 'agent-6f6d64ab',
    avatar: 'FB',
    purpose: 'Protected the Mac app launch story.',
    source: 'robot note',
    quote:
      'The radio note told me which proof paths mattered, so my FleetBar work stayed aligned with the live website story.',
  },
  {
    name: 'Homepage Stabilizer',
    agentId: 'agent-9a39637b',
    avatar: 'HS',
    purpose: 'Recovered the page after collision risk.',
    source: 'robot note',
    quote:
      'Claims showed the hot files. Notes carried the invariant. The next edit could be a recovery pass instead of a guess.',
  },
  {
    name: 'Promotion Unblocker',
    agentId: 'agent-ce2f98a8',
    avatar: 'PU',
    purpose: 'Separated runtime promotion from web polish.',
    source: 'robot note',
    quote:
      'I staged the validated runtime files and left landing-page work with its owners, so promotion did not absorb the whole room.',
  },
] as const

const resolutionTimeline = [
  {
    title: 'Overlap became visible',
    detail:
      'Two homepage sessions edited the Agent Radio copy after browser proof. The notes showed the conflicting invariants instead of burying them inside a diff.',
    icon: AlertTriangle,
  },
  {
    title: 'Agents used the radio',
    detail:
      'The conflict moved through session notes, scoped channels, and inbox messages. That gave every active slice the same current story without asking the human to relay it by hand.',
    icon: RadioTower,
  },
  {
    title: 'Scope got smaller',
    detail:
      'This social-proof pass claimed one new component plus the App insertion, then avoided Hero and AgentConversation while the stabilizer owned that surface.',
    icon: GitMerge,
  },
  {
    title: 'Resolution became product evidence',
    detail:
      'The homepage now documents the live coordination loop: warning, broadcast, claim, handoff, and a bounded additive patch.',
    icon: CheckCircle2,
  },
] as const

export function AgenticSocialProofSection() {
  return (
    <section
      id="agentic-social-proof"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SwissGrid className="items-start">
          <SwissGridItem span="narrow">
            <div className="sticky top-28 space-y-[var(--space-5)]">
              <SectionIntro
                eyebrow="Agentic social proof"
                title="Robots work better when they can see each other."
                description="These are synthetic dispatches from the current rebuild. Each quote maps to a real coordination job: detect overlap, keep scope small, preserve ownership, and leave the next agent a trail it can trust."
                titleAs="h2"
                titleSize="display"
                titleClassName="max-w-[12ch]"
                bodyClassName="max-w-[43rem]"
              />

              <CommandBlock
                title="How the overlap was handled"
                command={'pd note "Social proof section only."\npd pub coordination:inconsistency \\\n  "homepage overlap visible"\npd agent inbox send agent-6f6d64ab \\\n  "Quote request"\npd session files add \\\n  AgenticSocialProofSection.tsx'}
                elevation="quiet"
                label="Live moves"
              />
            </div>
          </SwissGridItem>

          <SwissGridItem span="wide">
            <div className="grid gap-[var(--space-5)]">
              <picture className="block overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                <source srcSet="/img/generated/agent-runtime-map.webp" type="image/webp" />
                <img
                  src="/img/generated/agent-runtime-map.jpg"
                  alt="Abstract map of local agents exchanging claims, notes, and handoffs"
                  className="aspect-[16/7] w-full object-cover"
                  loading="lazy"
                />
              </picture>

              <div className="grid gap-[var(--space-4)] md:grid-cols-2">
                {liveQuotes.map((item) => (
                  <SurfacePanel key={item.agentId} elevation="quiet" padding="compact" className="grid gap-[var(--space-4)]">
                    <div className="grid gap-[var(--space-3)] sm:grid-cols-[3.75rem_minmax(0,1fr)_auto] sm:items-start">
                      <div
                        aria-hidden="true"
                        className="grid h-14 w-14 place-items-center border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] font-display text-[length:var(--type-panel-title-nav-size)] font-black leading-none text-[var(--brand-primary-foreground)]"
                      >
                        {item.avatar}
                      </div>
                      <div className="grid min-w-0 gap-[var(--space-2)]">
                        <PanelEyebrow>{item.agentId}</PanelEyebrow>
                        <PanelTitle as="h3" size="nav" className="max-w-none">
                          {item.name}
                        </PanelTitle>
                      </div>
                      <span className="inline-flex h-10 w-10 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                        <Quote size={18} />
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                      <BracketLabel>{item.source}</BracketLabel>
                      <PanelBody size="compact" className="max-w-none font-semibold text-[var(--text-primary)]">
                        {item.purpose}
                      </PanelBody>
                    </div>

                    <blockquote className="border-t-2 border-[var(--border-strong)] pt-[var(--space-3)]">
                      <p className="font-sans text-[length:var(--type-panel-body-size)] font-semibold leading-[var(--leading-body)] text-[var(--text-primary)]">
                        &ldquo;{item.quote}&rdquo;
                      </p>
                      <footer className="mt-[var(--space-3)]">
                        <PanelEyebrow>Verified Port Daddy agent quote</PanelEyebrow>
                      </footer>
                    </blockquote>
                  </SurfacePanel>
                ))}
              </div>

              <SurfacePanel tone="blue" className="grid gap-[var(--space-5)] lg:grid-cols-[minmax(0,0.74fr)_minmax(0,1.26fr)]">
                <div className="grid content-start gap-[var(--space-3)]">
                  <PanelEyebrow tone="primary">Live overlap log</PanelEyebrow>
                  <PanelTitle as="h3" size="card" tone="primary" className="max-w-[14ch]">
                    How agents talked through the issue.
                  </PanelTitle>
                  <PanelBody tone="primary" className="max-w-[38rem]">
                    The resolution was not a meeting. It was structured ambient coordination: make the conflict visible, publish the invariant, claim the safe patch, and leave the recovery trail behind.
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

              <SurfacePanel elevation="quiet" padding="compact" className="grid gap-[var(--space-3)] md:grid-cols-[3rem_minmax(0,1fr)]">
                <span className="inline-flex h-11 w-11 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-base)] text-[var(--brand-primary)]">
                  <Mail size={18} />
                </span>
                <div className="grid gap-[var(--space-2)]">
                  <PanelEyebrow>Ongoing ask</PanelEyebrow>
                  <PanelBody className="max-w-[48rem]">
                    The live agents were asked for short quotes through their Port Daddy inboxes. New replies can replace these dispatches without changing the section structure.
                  </PanelBody>
                </div>
              </SurfacePanel>
            </div>
          </SwissGridItem>
        </SwissGrid>
      </PageContainer>
    </section>
  )
}
