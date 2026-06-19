import {
  BracketLabel,
  BracketLink,
  DocsCodeBlock as SiteDocsCodeBlock,
  DocsNoteCard,
  PanelBody,
  PanelList,
  SectionIntro,
  SurfacePanel,
} from '@/components/site/primitives'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'

const promptTemplate = `You are agent myrepo:docs:redesign.
Session purpose: redesign docs IA and styling.

Before edits:
1. Run: pd begin --identity myrepo:docs:redesign --purpose "Redesign docs IA" --lifecycle durable
2. Leave: pd note "Scope: docs IA, docs styling, no runtime files."
3. Claim: pd session files add website-v2/src/pages/docs/DocsOverview.tsx

During work:
- Leave a pd note at each milestone.
- Publish blockers to a project-scoped channel.
- Keep human approval steps out of the agent terminal.

Completion:
- Run tests and build.
- End with pd done "Docs IA and styling normalized."`

const promptResult = `Session started: session-docs-redesign-41af
Agent registered: myrepo:docs:redesign
Note added: Scope: docs IA, docs styling, no runtime files.
Claim added: website-v2/src/pages/docs/DocsOverview.tsx`

const approvalTemplate = `When a task reaches a destructive operation:
1. Stop before executing it.
2. Write the exact proposed command to pd note.
3. Surface the decision in Fleet Control Center Inbox.
4. Continue only after the human approves in the console UI.`

export default function PromptingAgents() {
  return (
    <div className="space-y-[var(--space-7)]">
      <div className="space-y-[var(--space-4)]">
        <BracketLabel>Guides</BracketLabel>
        <SectionIntro
          eyebrow="Prompting agents"
          title="Tell the agent what Port Daddy must prove."
          description="A good Port Daddy prompt names the agent, the scope, the files it can touch, the evidence it must leave, and the human decisions that must stay in Fleet Control Center."
          titleAs="h1"
          titleSize="section"
          titleClassName="max-w-[18ch]"
          bodyClassName="max-w-[52rem]"
        />
      </div>

      <DocsNoteCard label="Template" title="Start with identity, scope, claims, and evidence." elevation="quiet" padding="compact" titleSize="nav">
        <SiteDocsCodeBlock code={promptTemplate} language="text" label="Prompt body" />
        <DocsCodeBlock code="pd begin --identity myrepo:docs:redesign --purpose 'Redesign docs IA' --lifecycle durable && pd note 'Scope: docs IA, docs styling, no runtime files.'" output={promptResult} label="Expected Port Daddy trace" />
      </DocsNoteCard>

      <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--panel-gap)]">
        <BracketLabel>Required constraints</BracketLabel>
        <PanelList
          items={[
            'Bind an explicit identity in project:role:task form.',
            'Say which files or sections the agent may touch.',
            'Require notes, claims, and a completion summary.',
            'Set a budget ceiling before spawning any backend.',
            'Route destructive decisions to Fleet Control Center, not a hidden terminal prompt.',
          ]}
        />
      </SurfacePanel>

      <DocsNoteCard label="Human layer" title="The person approves risk in the console UI." elevation="quiet" padding="compact" titleSize="nav">
        <PanelBody size="compact" className="max-w-[52rem]">
          The agent can prepare the command. The human decides in Fleet Control Center Inbox, Flow, or Activity,
          where the request, affected files, and rollback note are visible together.
        </PanelBody>
        <SiteDocsCodeBlock code={approvalTemplate} language="text" label="Approval rule" />
      </DocsNoteCard>

      <div className="flex flex-wrap gap-[var(--panel-gap-tight)]">
        <BracketLink to="/docs/guides/templates" tone="blue">Template quickstarts</BracketLink>
        <BracketLink to="/docs/guides/protocol" tone="accent">Protocol and state</BracketLink>
        <BracketLink to="/docs/features/fleet" tone="blue">Fleet agents</BracketLink>
      </div>
    </div>
  )
}
