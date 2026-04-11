import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Terminal, Code, Cpu, Globe, Sparkles, Workflow } from 'lucide-react'

const PRODUCT_TOC = [
  { label: 'Quick Start', href: '/docs/quickstart', detail: 'Install, run, first session in minutes' },
  { label: 'Prompting Port Daddy Agents', href: '/docs/guides/prompting-agents', detail: 'How to write agent-safe task prompts' },
  { label: 'Template Quickstarts', href: '/docs/guides/templates', detail: 'Hello world, swarm, bug hunt, docs writer fleets' },
  { label: 'Agent Protocol & State', href: '/docs/guides/protocol', detail: 'Lifecycle, resumability, event handlers, sync model' },
]

const REFERENCES = [
  { title: 'CLI Reference', href: '/docs/cli', icon: Terminal, description: 'Command surface for daily operator work.' },
  { title: 'SDK Reference', href: '/docs/sdk', icon: Code, description: 'TypeScript surface for programmatic integrations.' },
  { title: 'MCP Tools', href: '/docs/mcp', icon: Cpu, description: 'Tool-call bridge for external assistants and IDEs.' },
  { title: 'REST API', href: '/docs/api', icon: Globe, description: 'HTTP contracts with examples and response bodies.' },
]

export default function DocsOverview() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <Badge variant="teal">Port Daddy Documentation</Badge>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight text-[var(--text-primary)]">
          Build Durable Multi-Agent Systems.
        </h1>
        <p className="text-lg sm:text-xl max-w-3xl leading-relaxed text-[var(--text-secondary)]">
          Port Daddy is the local agent control plane: identity, coordination, recovery, and operator visibility in one runtime.
          This docs landing is organized for both onboarding and deep production reference.
        </p>
      </section>

      <Surface depth="raised" radius="xl" padding="lg" className="space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-[var(--brand-primary)]" />
          <h2 id="table-of-contents" className="text-xl font-semibold text-[var(--text-primary)]">Table of contents</h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRODUCT_TOC.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-3 hover:border-[var(--border-default)] hover:bg-[var(--interactive-hover)] transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</span>
                <ArrowRight size={14} className="text-[var(--text-muted)]" />
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{item.detail}</p>
            </Link>
          ))}
        </div>
      </Surface>

      <div
        className="rounded-xl border-l-4 p-4"
        style={{
          borderLeftColor: 'var(--status-info)',
          background: 'color-mix(in srgb, var(--status-info) 8%, var(--surface-raised))',
          boxShadow: 'var(--shadow-flat)',
        }}
      >
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">Attention:</strong> This docs IA now treats onboarding, guides, and reference as separate tracks.
          Learn concepts first, then choose CLI/SDK/MCP/API based on your interface.
        </p>
      </div>

      <section className="space-y-3">
        <h2 id="reference-surfaces" className="text-2xl font-semibold text-[var(--text-primary)]">Reference Surfaces</h2>
        <p className="text-[var(--text-secondary)]">
          Each surface hits the same daemon, but with different ergonomics and audience expectations.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {REFERENCES.map((ref) => (
            <Link
              key={ref.href}
              to={ref.href}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4 hover:border-[var(--border-default)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[var(--interactive-hover)] flex items-center justify-center">
                  <ref.icon size={18} className="text-[var(--brand-primary)]" />
                </div>
                <h3 className="font-semibold text-[var(--text-primary)]">{ref.title}</h3>
              </div>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{ref.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 id="architecture" className="text-2xl font-semibold text-[var(--text-primary)]">System Architecture</h2>
        <p className="text-[var(--text-secondary)]">
          Port Daddy treats multi-agent collaboration as an evented protocol, not ad-hoc shell scripting.
        </p>
        <Surface depth="raised" radius="xl" padding="lg" className="space-y-2">
          <div className="flex items-center gap-2">
            <Workflow size={16} className="text-[var(--brand-secondary)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Core lifecycle</p>
          </div>
          <ol className="list-decimal pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
            <li>Agent begins a session with identity + intent.</li>
            <li>Work emits notes, channel signals, file claims, and artifacts.</li>
            <li>If an agent fails, salvage transfers state and continuity to a new worker.</li>
            <li>Broadcasts keep all connected clients synchronized in real time.</li>
          </ol>
          <p className="text-xs text-[var(--text-muted)]">
            Detailed protocol diagrams and message contracts: <Link className="text-[var(--brand-primary)] underline" to="/docs/guides/protocol">Agent Protocol &amp; State</Link>.
          </p>
        </Surface>
      </section>

      <section className="space-y-3">
        <h2 id="next-steps" className="text-2xl font-semibold text-[var(--text-primary)]">Next Steps</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/docs/quickstart" className="rounded-xl p-4 border border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Run your first daemon</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Install, status check, claim, and begin flow.</p>
          </Link>
          <Link to="/docs/api" className="rounded-xl p-4 border border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Inspect API contracts</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Endpoint groups, examples, and payloads.</p>
          </Link>
          <Link to="/docs/guides/prompting-agents" className="rounded-xl p-4 border border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Prompting patterns</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Make agents reliable under coordination constraints.</p>
          </Link>
          <Link to="/docs/guides/templates" className="rounded-xl p-4 border border-[var(--border-subtle)] bg-[var(--surface-raised)] hover:bg-[var(--interactive-hover)] transition-colors">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Fleet templates</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Copy-paste starter fleets for common engineering tasks.</p>
          </Link>
        </div>
        <div className="pt-2">
          <Link to="/docs/quickstart" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-primary)] text-[var(--text-inverse)] font-medium">
            Start with Quick Start
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 id="changelog" className="text-2xl font-semibold text-[var(--text-primary)]">What Changed In This IA</h2>
        <ul className="list-disc pl-5 text-sm space-y-1 text-[var(--text-secondary)]">
          <li>Docs now prioritize product narrative before raw command listings.</li>
          <li>Prompting and template guides were promoted to first-class docs pages.</li>
          <li>Search is now top-navbar first with global keyboard trigger (<code>{typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</code>).</li>
          <li>Inline code and terminal surfaces were tuned for stronger visual contrast and scanability.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 id="roadmap" className="text-2xl font-semibold text-[var(--text-primary)]">Roadmap Direction</h2>
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
          <p className="text-sm text-[var(--text-secondary)]">
            New roadmap entries include queue-first background agents, explicit human-in-the-loop tool patterns,
            event-driven state handlers, and menu bar driven task decomposition for fleet execution.
          </p>
          <div className="mt-3">
            <Link to="/roadmap" className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)]">
              View roadmap page
              <Sparkles size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
