import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import {
  BracketLabel,
  BracketLink,
  PageContainer,
  PanelBody,
  PanelEyebrow,
  PanelTitle,
  SurfacePanel,
  TruthBadge,
} from './primitives'

// Per-primitive stories. The composition-heavy story file is
// PublicPrimitives.stories.tsx; this file exercises each primitive's
// own size, tone, and overflow surface so a regression in any single
// token resolves to a single failing story.

const meta = {
  title: 'Site/Primitives',
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="bg-[var(--surface-base)] p-[var(--space-6)]">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const longParagraph =
  'Port Daddy turns multi-agent work into inspectable state — sessions, claims, notes, channels — so a hand-off between two terminals is a record instead of a hope. Long paragraphs like this one stress the line-height, max-width, and tracking decisions that the body primitive carries. The right answer for body copy is tokens, not literal pixel choices that will drift across surfaces.'
const longTitle =
  'A title long enough that it exposes the leading and tracking decisions baked into the display tokens, including a soft-wrap at the comma'

// ─── PanelTitle ─────────────────────────────────────────────────

export const PanelTitleSizes: Story = {
  name: 'PanelTitle / sizes',
  render: () => (
    <div className="grid gap-[var(--space-5)]">
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>Hero</BracketLabel>
        <PanelTitle size="hero">A local control plane for coding agents.</PanelTitle>
      </div>
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>Section / display</BracketLabel>
        <PanelTitle size="section">Sessions outlive the terminal that started them.</PanelTitle>
      </div>
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>Card</BracketLabel>
        <PanelTitle size="card">File claims are advisory, not a lock.</PanelTitle>
      </div>
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>Nav</BracketLabel>
        <PanelTitle size="nav">Coordination guard</PanelTitle>
      </div>
    </div>
  ),
}

export const PanelTitleTones: Story = {
  name: 'PanelTitle / tones',
  render: () => (
    <div className="grid gap-[var(--space-4)]">
      <SurfacePanel tone="paper">
        <PanelTitle size="card">Default tone on paper surface</PanelTitle>
      </SurfacePanel>
      <SurfacePanel tone="blue">
        <PanelTitle size="card" tone="primary">
          Primary tone on blue surface
        </PanelTitle>
      </SurfacePanel>
      <SurfacePanel tone="accent">
        <PanelTitle size="card" tone="accent">
          Accent tone on accent surface
        </PanelTitle>
      </SurfacePanel>
    </div>
  ),
}

export const PanelTitleCaps: Story = {
  name: 'PanelTitle / caps modifier',
  render: () => (
    <div className="grid gap-[var(--space-3)]">
      <PanelTitle size="card">Default casing keeps the typesetter honest</PanelTitle>
      <PanelTitle size="card" caps>
        Caps modifier for nav and label states
      </PanelTitle>
    </div>
  ),
}

export const PanelTitleLongContent: Story = {
  name: 'PanelTitle / long-content overflow',
  render: () => (
    <div className="grid gap-[var(--space-5)]">
      <div className="max-w-[42rem]">
        <PanelTitle size="hero">{longTitle}</PanelTitle>
      </div>
      <div className="max-w-[28rem]">
        <PanelTitle size="section">{longTitle}</PanelTitle>
      </div>
      <div className="max-w-[14rem]">
        <PanelTitle size="card">{longTitle}</PanelTitle>
      </div>
    </div>
  ),
}

// ─── PanelBody ──────────────────────────────────────────────────

export const PanelBodySizes: Story = {
  name: 'PanelBody / sizes',
  render: () => (
    <div className="grid gap-[var(--space-4)]">
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>default</BracketLabel>
        <PanelBody>
          The default body size carries section-level explanation and stays inside the
          measure-copy max-width unless the consumer overrides it.
        </PanelBody>
      </div>
      <div className="grid gap-[var(--space-2)]">
        <BracketLabel>compact</BracketLabel>
        <PanelBody size="compact">
          Compact body works for in-card copy, list items as prose, and aside slots where
          line-height has to drop a notch to keep the card readable.
        </PanelBody>
      </div>
    </div>
  ),
}

export const PanelBodyTones: Story = {
  name: 'PanelBody / tones',
  render: () => (
    <div className="grid gap-[var(--space-4)]">
      <SurfacePanel tone="paper">
        <PanelBody>
          Default tone — secondary text on the raised paper surface. This is the
          workhorse tone; most body copy sits here.
        </PanelBody>
      </SurfacePanel>
      <SurfacePanel tone="blue">
        <PanelBody tone="primary">
          Primary tone — readable at AA on the brand-primary surface, used for
          coordinated highlight states.
        </PanelBody>
      </SurfacePanel>
      <SurfacePanel tone="accent">
        <PanelBody tone="accent">
          Accent tone — readable at AA on the brand-accent surface, used sparingly so the
          accent retains its warning-level emphasis.
        </PanelBody>
      </SurfacePanel>
    </div>
  ),
}

export const PanelBodyLongContent: Story = {
  name: 'PanelBody / long-content overflow',
  render: () => (
    <div className="grid gap-[var(--space-5)]">
      <SurfacePanel tone="paper">
        <PanelBody>{longParagraph}</PanelBody>
      </SurfacePanel>
      <SurfacePanel tone="blue">
        <PanelBody size="compact" tone="primary">
          {longParagraph}
        </PanelBody>
      </SurfacePanel>
      <div className="max-w-[18rem]">
        <SurfacePanel tone="paper">
          <PanelBody size="compact" className="max-w-none">
            {longParagraph}
          </PanelBody>
        </SurfacePanel>
      </div>
    </div>
  ),
}

// ─── PanelEyebrow ───────────────────────────────────────────────

export const PanelEyebrowTones: Story = {
  name: 'PanelEyebrow / tones',
  render: () => (
    <div className="grid gap-[var(--space-4)]">
      <SurfacePanel tone="paper">
        <PanelEyebrow>Default eyebrow / paper</PanelEyebrow>
      </SurfacePanel>
      <SurfacePanel tone="blue">
        <PanelEyebrow tone="primary">Primary eyebrow / blue</PanelEyebrow>
      </SurfacePanel>
      <SurfacePanel tone="accent">
        <PanelEyebrow tone="accent">Accent eyebrow / accent</PanelEyebrow>
      </SurfacePanel>
    </div>
  ),
}

export const PanelEyebrowLongContent: Story = {
  name: 'PanelEyebrow / long-content',
  render: () => (
    <div className="grid max-w-[18rem] gap-[var(--space-3)]">
      <PanelEyebrow>Coordination guard / staged-file enforcement / pre-commit hook</PanelEyebrow>
      <PanelEyebrow tone="primary">
        For AI engineering teams running real coordinated agent workflows in production
      </PanelEyebrow>
    </div>
  ),
}

// ─── BracketLabel ───────────────────────────────────────────────

export const BracketLabelSides: Story = {
  name: 'BracketLabel / sides',
  render: () => (
    <div className="flex flex-wrap gap-[var(--space-3)]">
      <BracketLabel side="left">left only</BracketLabel>
      <BracketLabel side="right">right only</BracketLabel>
      <BracketLabel side="both">both sides</BracketLabel>
    </div>
  ),
}

export const BracketLabelTones: Story = {
  name: 'BracketLabel / tones',
  render: () => (
    <div className="grid gap-[var(--space-4)]">
      <div className="flex flex-wrap items-center gap-[var(--space-3)] bg-[var(--surface-raised)] p-[var(--space-4)]">
        <BracketLabel>default</BracketLabel>
        <BracketLabel tone="primary">primary</BracketLabel>
        <BracketLabel tone="accent">accent</BracketLabel>
      </div>
      <SurfacePanel tone="blue" className="flex flex-wrap items-center gap-[var(--space-3)]">
        <BracketLabel>inherits surface</BracketLabel>
        <BracketLabel tone="primary">primary</BracketLabel>
      </SurfacePanel>
      <SurfacePanel tone="accent" className="flex flex-wrap items-center gap-[var(--space-3)]">
        <BracketLabel>inherits surface</BracketLabel>
        <BracketLabel tone="accent">accent</BracketLabel>
      </SurfacePanel>
    </div>
  ),
}

export const BracketLabelLongContent: Story = {
  name: 'BracketLabel / long-content',
  render: () => (
    <div className="grid gap-[var(--space-3)]">
      <div>
        <BracketLabel>
          Coordination guard / staged file inspection / per-claim enforcement
        </BracketLabel>
      </div>
      <div className="max-w-[14rem]">
        <BracketLabel>Wraps when the container forces it to wrap</BracketLabel>
      </div>
    </div>
  ),
}

// ─── BracketLink (interactive variant) ──────────────────────────

export const BracketLinkInteractive: Story = {
  name: 'BracketLink / interactive states',
  render: () => (
    <div className="flex flex-wrap items-center gap-[var(--space-3)]">
      <BracketLink to="#install" tone="blue">
        Install
      </BracketLink>
      <BracketLink to="#guard" tone="accent">
        Guard
      </BracketLink>
      <BracketLink to="#sessions" tone="blue" side="left">
        Sessions
      </BracketLink>
      <BracketLink to="#salvage" tone="accent" side="right">
        Salvage
      </BracketLink>
    </div>
  ),
}

// ─── TruthBadge ─────────────────────────────────────────────────

export const TruthBadgeStates: Story = {
  name: 'TruthBadge / states',
  render: () => (
    <div className="flex flex-wrap items-center gap-[var(--space-3)]">
      <TruthBadge truth="Live" />
      <TruthBadge truth="Roadmap" />
    </div>
  ),
}

// ─── Theme matrix ───────────────────────────────────────────────
// The Storybook theme toolbar (light/dark) drives data-theme; this
// story bundles the load-bearing primitives so we can flip theme and
// eyeball the contrast on every primitive at once.

export const ThemeMatrix: Story = {
  name: 'Theme matrix (flip Storybook theme)',
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <PageContainer width="default" className="grid gap-[var(--space-5)]">
      <div className="grid gap-[var(--space-3)]">
        <BracketLabel>Theme matrix</BracketLabel>
        <PanelTitle size="display">All primitives in one place</PanelTitle>
        <PanelBody>
          Flip the Storybook theme toolbar between light and dark to verify every
          primitive resolves through the token layer instead of a literal color.
        </PanelBody>
      </div>

      <div className="grid gap-[var(--space-4)] md:grid-cols-3">
        <SurfacePanel tone="paper" className="space-y-[var(--space-3)]">
          <PanelEyebrow>paper</PanelEyebrow>
          <PanelTitle size="card">Paper surface</PanelTitle>
          <PanelBody size="compact" className="max-w-none">
            Default content. Body copy reads against the raised paper background in both
            themes.
          </PanelBody>
          <BracketLabel>label</BracketLabel>
        </SurfacePanel>

        <SurfacePanel tone="blue" className="space-y-[var(--space-3)]">
          <PanelEyebrow tone="primary">primary</PanelEyebrow>
          <PanelTitle size="card" tone="primary">
            Primary surface
          </PanelTitle>
          <PanelBody size="compact" tone="primary" className="max-w-none">
            Brand-primary surface. Primary-tone body and eyebrow keep AA contrast in both
            themes.
          </PanelBody>
          <BracketLabel tone="primary">label</BracketLabel>
        </SurfacePanel>

        <SurfacePanel tone="accent" className="space-y-[var(--space-3)]">
          <PanelEyebrow tone="accent">accent</PanelEyebrow>
          <PanelTitle size="card" tone="accent">
            Accent surface
          </PanelTitle>
          <PanelBody size="compact" tone="accent" className="max-w-none">
            Accent surface. Used sparingly. Reserved for warning-level emphasis where the
            primary brand surface is too quiet.
          </PanelBody>
          <BracketLabel tone="accent">label</BracketLabel>
        </SurfacePanel>
      </div>
    </PageContainer>
  ),
}
