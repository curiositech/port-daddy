import { Quote } from 'lucide-react'
import {
  BracketLabel,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'

// IA audit (2026-05-20): this section previously rendered four
// parallel sub-panels (live-trace, coordination receipts, resolution
// timeline, agent-runtime-map image), all doing variants of the same
// "you can trust the trail" job. The auditor's call was "collapse to
// 3 quote cards max — quotes are the strongest element; everything
// else is elaboration of elaboration." Plus: the agent-runtime-map
// image was already floating as a Hero background, so it was visual
// repetition. Plus: the resolution-timeline belongs in
// CoordinationEnforcementSection contextually, not here.
//
// Slice 1 keeps the three quotes and the intro. The Resolution
// Timeline + Coordination Trace + Coordination Receipts panels were
// stripped here; a follow-up slice can re-locate the resolution
// timeline into CoordinationEnforcementSection if it earns the scroll
// there. The four-card receipts grid was redundant and is gone.
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
      'The useful part was durable state, not another prompt: current proof paths, install truth, and the file surfaces already claimed.',
  },
  {
    name: 'Homepage Stabilizer',
    agentId: 'agent-9a39637b',
    purpose: 'Stabilize homepage framing after a concurrent overwrite.',
    source: 'Logged agent note',
    quote:
      'The conflict stayed legible. The claim trail was visible, so I could preserve the product thesis and make recovery a deliberate edit instead of a guess.',
  },
] as const

export function AgenticSocialProofSection() {
  return (
    <section
      id="agentic-social-proof"
      className="border-t-2 border-[var(--border-strong)] bg-[var(--surface-base)] py-[var(--section-space-y)] lg:py-[var(--section-space-y-lg)]"
    >
      <PageContainer width="wide">
        <SectionIntro
          eyebrow="Dogfood receipts"
          title="The agents can say what the control plane changed."
          description="These are not customer testimonials. They are agent-facing receipts from real Port Daddy website work: claims, notes, inboxes, broadcasts, and recovery traces that made overlapping edits visible before they became silent damage."
          titleAs="h2"
          titleSize="display"
          titleClassName="max-w-[13ch]"
          bodyClassName="max-w-[43rem]"
        />

        <div className="mt-[var(--space-6)] grid gap-[var(--space-4)] md:grid-cols-3">
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
      </PageContainer>
    </section>
  )
}
