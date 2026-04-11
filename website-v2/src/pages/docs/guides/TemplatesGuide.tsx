import { Badge } from '@/components/ui/Badge'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

const TEMPLATES = [
  {
    name: 'Hello World Agent',
    summary: 'Single-agent setup for one focused task.',
    command: `pd begin "hello world task" --identity myrepo:helper:hello`,
  },
  {
    name: 'Multi-Agent Swarm',
    summary: 'Planner + implementer + reviewer pipeline with channel coordination.',
    command: `pd spawn --backend codex --tier low --identity myrepo:planner:swarm -- "Decompose task and publish plan"
pd spawn --backend codex --tier mid --identity myrepo:builder:swarm -- "Implement planned slice and emit notes"
pd spawn --backend codex --tier low --identity myrepo:reviewer:swarm -- "Run review checklist and summarize risks"`,
  },
  {
    name: 'Bug Hunt Fleet',
    summary: 'Repro + fix + adversarial test creation.',
    command: `pd spawn --backend codex --tier low --identity myrepo:repro:bug -- "Reproduce issue and isolate minimal failing case"
pd spawn --backend codex --tier mid --identity myrepo:fixer:bug -- "Patch root cause with tests"
pd spawn --backend codex --tier low --identity myrepo:adversary:test -- "Write regression and edge-case tests"` ,
  },
  {
    name: 'Documentation Writer Team',
    summary: 'Researcher + writer + API verifier for long-form technical guides.',
    command: `pd spawn --backend codex --tier low --identity myrepo:researcher:docs -- "Collect facts and references"
pd spawn --backend codex --tier mid --identity myrepo:writer:docs -- "Draft comprehensive guide"
pd spawn --backend codex --tier low --identity myrepo:validator:api -- "Verify commands/examples against source"` ,
  },
]

export default function TemplatesGuide() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Badge variant="teal">Guides</Badge>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">Template Quickstarts</h1>
        <p className="text-lg text-[var(--text-secondary)] max-w-3xl">
          Starter patterns for common Port Daddy workflows. Copy a template, then adapt identity, tier, and scope.
        </p>
      </div>

      <div className="rounded-xl border-l-4 p-4" style={{ borderLeftColor: 'var(--status-info)', background: 'color-mix(in srgb, var(--status-info) 8%, var(--surface-raised))' }}>
        <p className="text-sm text-[var(--text-secondary)]">
          Prefer low/mid tiers by default and promote to high tiers only for genuinely complex reasoning steps.
        </p>
      </div>

      <div className="space-y-4">
        {TEMPLATES.map((template) => (
          <Surface key={template.name} depth="raised" radius="xl" padding="lg" className="space-y-3">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">{template.name}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{template.summary}</p>
            <CodeBlock language="bash">{template.command}</CodeBlock>
          </Surface>
        ))}
      </div>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-3">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Next: Protocol Deep Dive</h2>
        <p className="text-sm text-[var(--text-secondary)]">
          Understand message flow, persisted state, resumable work, and event handlers.
        </p>
        <Link to="/docs/guides/protocol" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)]">
          Agent Protocol &amp; State
          <ArrowRight size={14} />
        </Link>
      </Surface>
    </div>
  )
}
