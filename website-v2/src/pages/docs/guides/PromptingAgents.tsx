import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight, MessageSquare, ShieldAlert } from 'lucide-react'

export default function PromptingAgents() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Badge variant="teal">Guides</Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">Prompting Agents For Port Daddy</h1>
        <p className="text-lg text-[var(--text-secondary)] max-w-3xl">
          Reliable fleet behavior starts with prompts that encode identity, scope, locks, and handoff obligations.
          Treat prompts as protocol contracts, not just prose requests.
        </p>
      </div>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Prompt Template</h2>
        <CodeBlock language="bash">{`You are agent myrepo:docs:redesign.
Session purpose: redesign docs IA + styling.

Before edits:
1) Run pd begin --identity myrepo:docs:redesign
2) Leave pd note with intended file scope
3) Acquire claims/locks for high-contention files

During work:
- Emit pd note on milestone completion
- Publish significant events to project-scoped channels
- Preserve explicit handoff notes when blocked

Completion:
- Run tests
- pd done with concise summary + touched files`}</CodeBlock>
      </Surface>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-[var(--brand-primary)]" />
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Required Prompt Constraints</h2>
        </div>
        <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
          <li>Always bind an explicit identity (`project:role:task`).</li>
          <li>Require session lifecycle (`begin` / notes / `done`).</li>
          <li>Declare file claims for overlapping critical files.</li>
          <li>Declare budget ceilings before spawning expensive backends.</li>
          <li>Specify escalation behavior for blocked or ambiguous states.</li>
        </ul>
      </Surface>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[var(--brand-secondary)]" />
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Human-In-The-Loop Pattern</h2>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          Add an explicit “approval checkpoint” instruction inside long-running prompts for risky operations
          (schema migrations, irreversible file moves, production deployment commands).
        </p>
        <CodeBlock language="bash">{`If the task reaches a destructive or irreversible operation:
- Pause execution
- Emit a summary via pd note and channel message
- Request approval with the exact command and rollback plan
- Continue only after approval token is received`}</CodeBlock>
      </Surface>

      <div className="rounded-xl border-l-4 p-4" style={{ borderLeftColor: 'var(--status-info)', background: 'color-mix(in srgb, var(--status-info) 8%, var(--surface-raised))' }}>
        <p className="text-sm text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">Tip:</strong> Use the same prompting pattern across CLI, SDK, and MCP entrypoints so behavior does not drift by interface.
        </p>
      </div>

      <div className="pt-2">
        <Link to="/docs/guides/templates" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)]">
          Continue to Template Quickstarts
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  )
}
