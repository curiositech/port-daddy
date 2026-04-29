import type { Meta, StoryObj } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import {
  BracketAnchor,
  CommandBlock,
  DocsCard,
  DocsCodeBlock,
  DocsNoteCard,
  LandingArchitectureCard,
  LandingCommercialCard,
  LandingProofCard,
  LandingSection,
  LandingSectionIntro,
  LandingStatsStrip,
  PageContainer,
  PanelBody,
  PanelList,
  SectionIntro,
  SectionFrame,
  SurfacePanel,
  SwissGrid,
  SwissGridItem,
  TruthBadge,
} from './primitives'
import { commercialTracks, proofPanels, proofStats } from '@/data/publicSite'

const meta = {
  title: 'Site/Public Primitives',
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

export const TruthBadges: Story = {
  render: () => (
    <div className="flex flex-wrap gap-[var(--space-4)]">
      <TruthBadge truth="Live" />
      <TruthBadge truth="Roadmap" />
    </div>
  ),
}

export const SectionFrameExample: Story = {
  render: () => (
    <SectionFrame
      eyebrow="Architecture"
      title="Section primitives carry the shell"
      description="Reusable section framing for the Port Daddy marketing and docs surfaces."
    >
      <div className="grid gap-[var(--space-4)]">
        <SurfacePanel>
          <PanelBody className="max-w-none">
            Reusable sections live in the component layer instead of directly in page markup.
          </PanelBody>
        </SurfacePanel>
        <SurfacePanel>
          <PanelBody className="max-w-none">
            Typography and spacing do most of the work; card chrome stays subordinate.
          </PanelBody>
        </SurfacePanel>
      </div>
    </SectionFrame>
  ),
}

export const LayoutPrimitives: Story = {
  render: () => (
    <PageContainer width="wide" className="border-2 border-[var(--border-strong)] py-[var(--section-space-y)]">
      <SwissGrid>
        <SwissGridItem span="rail">
          <SectionIntro
            eyebrow="Layout primitives"
            title="One grid system. One section-intro system."
            description="These primitives anchor the preserved landing and the newer docs shell to the same spacing, width, and typography decisions."
            titleClassName="max-w-[14ch]"
          />
        </SwissGridItem>
        <SwissGridItem span="body">
          <SurfacePanel elevation="quiet">
            <PanelBody className="max-w-[var(--measure-copy)]">
              New rehabbed routes can compose asymmetrical 12-column layouts without inventing local grid
              math or widening code-heavy panels on mobile.
            </PanelBody>
          </SurfacePanel>
        </SwissGridItem>
      </SwissGrid>
    </PageContainer>
  ),
}

export const CommandBlocks: Story = {
  render: () => (
    <div className="grid max-w-[45rem] gap-[var(--space-4)]">
      <CommandBlock truth="Live" title="Install today" command={'brew install curiositech/tap/port-daddy && pd setup'} />
      <CommandBlock
        truth="Roadmap"
        title="Remote orchestration"
        command={'pd fleet launch --project ./your-repo'}
      />
    </div>
  ),
}

export const DocsCards: Story = {
  render: () => (
    <div className="grid gap-[var(--space-4)] md:grid-cols-2">
      <DocsCard
        kicker="01"
        title="Getting Started"
        summary="Install the daemon and bring up the control plane."
        href="/docs/getting-started"
        tone="blue"
      />
      <DocsCard
        kicker="02"
        title="Security"
        summary="Review the harbor model, verification posture, and the host-level security gap."
        href="/docs/security"
        tone="paper"
      />
    </div>
  ),
}

export const DocsNotesAndAnchors: Story = {
  render: () => (
    <div className="grid gap-[var(--space-4)] lg:grid-cols-[minmax(0,1fr)_var(--docs-rail-width)]">
      <DocsNoteCard label="Operator note" title="Use the canonical runtime checks first" tone="paper">
        <PanelBody className="max-w-none">
          Keep the public docs tied to runtime truth instead of trying to explain every subsystem on one page.
        </PanelBody>
        <PanelList
          items={[
            'Check the live daemon before trusting the shell surface.',
            'Keep source references visible on the same page.',
            'Use one note-card system across overview, section, and leaf pages.',
          ]}
        />
      </DocsNoteCard>

      <DocsNoteCard label="Page map" title="Jump by block" tone="paper">
        <div className="flex flex-col gap-[var(--space-2)]">
          <BracketAnchor href="#install" side="left" tone="blue" active>
            Install
          </BracketAnchor>
          <BracketAnchor href="#verify-runtime" side="right" tone="accent">
            Verify runtime
          </BracketAnchor>
          <BracketAnchor href="#first-coordination-success" side="left" tone="blue">
            First coordination success
          </BracketAnchor>
        </div>
      </DocsNoteCard>
    </div>
  ),
}

export const DocsCodeSurfaces: Story = {
  render: () => (
    <div className="grid max-w-[56rem] gap-[var(--space-4)]">
      <DocsCodeBlock
        code={'brew install curiositech/tap/port-daddy && pd setup\npd status\npd briefing'}
        language="cli"
        label="Operator bootstrap"
      />
      <DocsCodeBlock
        code={'const daemonUrl = await resolveDaemonUrl()\nconst fleet = await fetch(`${daemonUrl}/fleet`).then((response) => response.json())'}
        language="typescript"
        label="Runtime verification"
      />
    </div>
  ),
}

export const LandingSectionShell: Story = {
  render: () => (
    <LandingSection>
      <div className="grid gap-[var(--space-6)] xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <LandingSectionIntro
          eyebrow="Formal verification"
          title="We show the work"
          description="Landing sections use one shared shell, one intro system, and token-driven spacing instead of ad hoc page markup."
        />
        <LandingProofCard panel={proofPanels[0]} />
      </div>
    </LandingSection>
  ),
}

export const LandingSystemPanels: Story = {
  render: () => (
    <div className="grid gap-[var(--space-6)]">
      <LandingStatsStrip stats={proofStats} />
      <div className="grid gap-[var(--space-4)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <LandingArchitectureCard />
        <LandingCommercialCard track={commercialTracks[0]} />
      </div>
    </div>
  ),
}

export const StateMatrix: Story = {
  parameters: {
    a11y: {
      test: 'error',
    },
  },
  render: () => (
    <PageContainer width="wide" className="bg-[var(--surface-base)] py-[var(--section-space-y)]">
      <SwissGrid>
        <SwissGridItem span="rail">
          <SectionIntro
            eyebrow="Primitive matrix"
            title="Shared primitives carry states before routes do."
            description="This matrix keeps layout, panel tone, code, links, and dense editorial states visible in Storybook before they spread through page code."
            titleClassName="max-w-[14ch]"
          />
        </SwissGridItem>

        <SwissGridItem span="body" className="grid gap-[var(--space-4)]">
          <div className="grid gap-[var(--space-4)] lg:grid-cols-3">
            <SurfacePanel tone="paper" className="space-y-[var(--space-3)]">
              <PanelEyebrow>Default</PanelEyebrow>
              <PanelTitle as="h3" size="nav">Paper panel</PanelTitle>
              <PanelBody size="compact" className="max-w-none">
                Neutral content, long copy, and normal text contrast.
              </PanelBody>
            </SurfacePanel>
            <SurfacePanel tone="blue" className="space-y-[var(--space-3)]">
              <PanelEyebrow tone="primary">Selected</PanelEyebrow>
              <PanelTitle as="h3" size="nav" tone="primary">Primary panel</PanelTitle>
              <PanelBody size="compact" tone="primary" className="max-w-none">
                Selected or high-emphasis state with foreground tokens.
              </PanelBody>
            </SurfacePanel>
            <SurfacePanel tone="accent" className="space-y-[var(--space-3)]">
              <PanelEyebrow tone="accent">Accent</PanelEyebrow>
              <PanelTitle as="h3" size="nav" tone="accent">Accent panel</PanelTitle>
              <PanelBody size="compact" tone="accent" className="max-w-none">
                Positive state without local literal color decisions.
              </PanelBody>
            </SurfacePanel>
          </div>

          <SurfacePanel className="space-y-[var(--space-4)]">
            <PanelEyebrow>Interactive states</PanelEyebrow>
            <div className="flex flex-wrap gap-[var(--space-3)]">
              <BracketAnchor href="#default" tone="blue" active>
                Active anchor
              </BracketAnchor>
              <BracketAnchor href="#secondary" tone="accent">
                Secondary anchor
              </BracketAnchor>
              <BracketAnchor href="#quiet" side="left">
                Quiet anchor
              </BracketAnchor>
            </div>
            <DocsCodeBlock
              code={'pd status\npd briefing\npd note "storybook matrix checked"'}
              language="cli"
              label="Operator evidence"
            />
          </SurfacePanel>

          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <DocsNoteCard label="Empty state" title="No signals yet" tone="paper">
              <PanelBody size="compact" className="max-w-none">
                Empty content states still use a concrete title, explanation, and recoverable next action.
              </PanelBody>
            </DocsNoteCard>
            <DocsNoteCard label="Error state" title="Evidence missing" tone="paper">
              <PanelBody size="compact" className="max-w-none">
                Error states state what failed and which gate must be rerun.
              </PanelBody>
            </DocsNoteCard>
          </div>
        </SwissGridItem>
      </SwissGrid>
    </PageContainer>
  ),
}
