import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowRight, Terminal } from 'lucide-react'
import { DocsCodeBlock } from '@/components/docs/DocsCodeBlock'
import {
  SDK_METHOD_TOTAL,
  SDK_REFERENCE_GROUPS,
  referenceAnchor,
} from '@/data/referenceCatalog'

function MethodGroup({ group }: { group: (typeof SDK_REFERENCE_GROUPS)[number] }) {
  const anchor = referenceAnchor(group.title)
  const body = (
    <div className="group grid gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-5 transition-all hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-semibold text-[var(--text-primary)]">{group.title}</h3>
            {group.href ? <Badge variant="success">detail page</Badge> : <Badge variant="default">overview only</Badge>}
          </div>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">{group.description}</p>
          <p className="text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
            Source: <code>{group.source}</code>
          </p>
        </div>
        {group.href ? (
          <ArrowRight size={18} className="mt-1 shrink-0 text-[var(--text-muted)] transition-all group-hover:translate-x-1 group-hover:text-[var(--brand-primary)]" />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {group.items.map((method) => (
          <code
            id={referenceAnchor(method.name)}
            key={method.name}
            className="scroll-mt-24 rounded bg-[var(--code-bg)] px-2 py-1 font-mono text-[length:var(--type-meta-size)] text-[var(--brand-primary)]"
            title={method.description}
          >
            {method.name}()
          </code>
        ))}
      </div>
    </div>
  )

  if (!group.href) {
    return (
      <section id={anchor} className="scroll-mt-24">
        {body}
      </section>
    )
  }

  return (
    <Link id={anchor} to={group.href} className="block scroll-mt-24">
      {body}
    </Link>
  )
}

function CodeBlock({ code }: { code: string }) {
  return <DocsCodeBlock code={code} language="typescript" />
}

export default function SdkOverview() {
  return (
    <div className="space-y-12">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="teal">SDK</Badge>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)]">
          TypeScript SDK
        </h1>
        <p className="max-w-3xl text-xl leading-relaxed text-[var(--text-secondary)]">
          Programmatic access to the same daemon that powers the CLI and MCP server. This page now
          lists every public method on <code>PortDaddy</code> in <code>lib/client.ts</code>, including
          newer actor, budget, bond, pheromone, Arbiter, tuple, and sortie surfaces.
        </p>
        <p className="max-w-xl rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--text-muted)]">
          Use this reference when you are writing JavaScript or TypeScript. For terminal usage see the{' '}
          <a href="/docs/cli" className="text-[var(--brand-primary)] hover:underline">CLI reference</a>, or
          for LLM tool calls see the{' '}
          <a href="/docs/mcp" className="text-[var(--brand-primary)] hover:underline">MCP reference</a>.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{SDK_METHOD_TOTAL}</div>
          <div className="text-sm text-[var(--text-muted)]">public SDK methods listed</div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">{SDK_REFERENCE_GROUPS.length}</div>
          <div className="text-sm text-[var(--text-muted)]">method groups</div>
        </div>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-4">
          <div className="text-2xl font-semibold text-[var(--text-primary)]">2</div>
          <div className="text-sm text-[var(--text-muted)]">exports: named and default</div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Installation</h2>
        <p className="text-[var(--text-secondary)]">
          Install the package, then import from the client export.
        </p>
        <CodeBlock code={`npm install port-daddy

import { PortDaddy, type ClaimOptions, type SpawnSpec } from 'port-daddy/client'
import PortDaddyClient from 'port-daddy/client'`} />
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Quick Start</h2>
        <p className="text-[var(--text-secondary)]">
          The SDK exposes methods directly on the <code>PortDaddy</code> instance.
        </p>
        <CodeBlock code={`import { PortDaddy } from 'port-daddy/client'

const pd = new PortDaddy()

const { port } = await pd.claim('myapp:api:main')
await pd.begin('Building API preview', {
  lifecycle: 'durable',
  identity: 'myapp:api:main',
  files: ['src/server.ts']
})

await pd.note('Preview server claimed and booting')
console.log(\`Server running on port \${port}\`)

await pd.done('Preview ready')`} />
      </div>

      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Complete Method Catalog</h2>
          <p className="mt-2 max-w-3xl text-[var(--text-secondary)]">
            Detail pages remain focused on core modules, but the catalog below includes every public
            method currently defined on the SDK class.
          </p>
        </div>
        <div className="grid gap-4">
          {SDK_REFERENCE_GROUPS.map((group) => (
            <MethodGroup key={group.title} group={group} />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">Configuration</h2>
        <p className="text-[var(--text-secondary)]">
          The SDK auto-detects the Unix socket and falls back to the discovered daemon TCP URL.
        </p>
        <CodeBlock code={`const pd = new PortDaddy({
  socketPath: '~/.port-daddy/daemon.sock',
  url: process.env.PORT_DADDY_URL,
  timeout: 30000,
  agentId: process.env.PORT_DADDY_AGENT
})`} />
      </div>

      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-6">
        <h2 className="mb-4 text-xl font-semibold text-[var(--text-primary)]">Type Safety</h2>
        <p className="mb-4 leading-relaxed text-[var(--text-secondary)]">
          The published client export includes the <code>PortDaddy</code> class, error classes, and
          option/result types for the major SDK surfaces.
        </p>
        <CodeBlock code={`import { PortDaddy, ConnectionError, type SpawnSpec } from 'port-daddy/client'

const spec: SpawnSpec = {
  backend: 'codex',
  identity: 'myapp:docs:main',
  task: 'Audit the docs reference',
  budgetUsd: 2
}

try {
  await new PortDaddy().spawn(spec)
} catch (error) {
  if (error instanceof ConnectionError) {
    console.log('Start Port Daddy before spawning agents')
  }
}`} />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[var(--brand-primary)]/20 bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent p-6">
        <div>
          <div className="mb-1 text-sm text-[var(--text-muted)]">Also See</div>
          <div className="font-semibold text-[var(--text-primary)]">CLI Reference</div>
          <div className="text-sm text-[var(--text-muted)]">The terminal surface for the same daemon.</div>
        </div>
        <Link
          to="/docs/cli"
          className="flex items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-4 py-2 font-medium text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)]"
        >
          <Terminal size={16} />
          View CLI
        </Link>
      </div>
    </div>
  )
}
