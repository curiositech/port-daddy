import {
  BracketLabel,
  BracketLink,
  DocsNoteCard,
  PanelBody,
  PanelTitle,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

const TEMPLATES = [
  {
    name: 'Single helper',
    summary: 'One agent, one session, one narrow scope.',
    command: `pd begin "Investigate one failing route" --identity myrepo:helper:route --lifecycle durable
pd note "Scope: routes/auth.ts and tests/auth.test.ts"
pd session files add routes/auth.ts tests/auth.test.ts`,
    output: `Session started: session-helper-route
Note added to session-helper-route
Claims added: routes/auth.ts, tests/auth.test.ts`,
  },
  {
    name: 'Planner, builder, reviewer',
    summary: 'A cheap planner, a bounded implementer, and a skeptical reviewer.',
    command: `pd spawn --backend codex --tier low --identity myrepo:planner:swarm --budget 0.50 -- "Decompose the auth fix and publish a plan"
pd spawn --backend codex --tier mid --identity myrepo:builder:swarm --budget 1.25 -- "Implement the approved slice"
pd spawn --backend codex --tier low --identity myrepo:reviewer:swarm --budget 0.50 -- "Review the diff for regressions"`,
    output: `spawned-planner-sw... running as myrepo:planner:swarm
spawned-builder-sw... queued behind active claim checks
spawned-reviewer-sw... waiting for builder completion`,
  },
  {
    name: 'Bug hunt',
    summary: 'Separate reproduction, fix, and regression-test responsibilities.',
    command: `pd spawn --backend codex --tier low --identity myrepo:repro:bug --budget 0.50 -- "Find the smallest failing case"
pd spawn --backend codex --tier mid --identity myrepo:fixer:bug --budget 1.00 -- "Patch the root cause"
pd spawn --backend codex --tier low --identity myrepo:adversary:test --budget 0.50 -- "Write the regression test"`,
    output: `spawned-repro-bug... running
spawned-fixer-bug... blocked until reproduction note arrives
spawned-adversary-test... blocked until fix diff exists`,
  },
]

export default function TemplatesGuide() {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="space-y-[var(--space-4)]">
        <BracketLabel>Guides</BracketLabel>
        <SectionIntro
          eyebrow="Template quickstarts"
          title="Use templates that leave a trail."
          description="These are starting patterns for real Port Daddy work. Each one shows the command and the first observable result so an operator can tell whether coordination actually started."
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-[17ch]"
          bodyClassName="max-w-[50rem]"
        />
      </div>

      <DocsNoteCard label="Default stance" title="Spend low until the task earns more model." elevation="quiet" padding="compact" titleSize="nav">
        <PanelBody size="compact" className="max-w-[52rem]">
          Start with low or mid tiers, require a budget, and promote only the piece that needs deeper reasoning.
          The template should also say what waits for what, so the fleet does not silently stampede the repo.
        </PanelBody>
      </DocsNoteCard>

      <div className="grid gap-[var(--panel-gap)]">
        {TEMPLATES.map((template) => (
          <SurfacePanel key={template.name} elevation="quiet" padding="compact" className="space-y-[var(--panel-gap)]">
            <div className="space-y-[var(--space-2)]">
              <PanelTitle as="h2" size="nav" className="max-w-none">{template.name}</PanelTitle>
              <PanelBody size="compact" className="max-w-[52rem]">{template.summary}</PanelBody>
            </div>
            <DocsCodeBlock code={template.command} output={template.output} label="Command" />
          </SurfacePanel>
        ))}
      </div>

      <DocsNoteCard label="Next" title="Understand the protocol behind the templates." elevation="quiet" padding="compact" titleSize="nav">
        <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
          <BracketLink to="/docs/guides/protocol" tone="blue">Protocol and state</BracketLink>
          <BracketLink to="/docs/features/fleet" tone="accent">Fleet agents</BracketLink>
        </div>
      </DocsNoteCard>
    </div>
  )
}
