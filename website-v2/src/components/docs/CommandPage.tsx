import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { DocsCodeBlock as CodeBlock } from './DocsCodeBlock'

interface CommandPageProps {
  command: string
  shortFlag?: string
  description: string
  version: string
  syntax: string
  examples: Array<{
    description: string
    code: string
    output?: string
  }>
  flags?: Array<{
    flag: string
    description: string
  }>
  subcommands?: Array<{
    name: string
    description: string
    href: string
  }>
  usagePatterns?: string[]
  seeAlso?: Array<{
    name: string
    href: string
  }>
}

export function CommandPage({
  command,
  shortFlag,
  description,
  version,
  syntax,
  examples,
  flags,
  subcommands,
  usagePatterns,
  seeAlso
}: CommandPageProps) {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/cli" className="hover:text-[var(--text-primary)]">CLI</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">{command}</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">CLI</Badge>
          <Badge variant="default">v{version}</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight font-mono">
          {command}
          {shortFlag && <span className="text-[var(--text-muted)] text-2xl ml-2">({shortFlag})</span>}
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          {description}
        </p>
      </div>

      {/* Syntax */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Syntax</h2>
        <CodeBlock code={syntax} />
      </div>

      {/* Usage Patterns */}
      {usagePatterns && usagePatterns.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Usage Patterns</h2>
          <div
            className="p-5 rounded-2xl"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
            <ul className="space-y-2">
              {usagePatterns.map((pattern, i) => (
                <li key={i} className="font-mono text-sm text-[var(--text-secondary)]">
                  {pattern}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Flags */}
      {flags && flags.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Flags</h2>
          <div
            className="rounded-2xl overflow-hidden divide-y divide-[var(--border-subtle)]"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
            {flags.map((flag, i) => (
              <div key={i} className="p-4">
                <code className="text-sm font-mono text-[var(--brand-primary)]">{flag.flag}</code>
                <p className="text-sm text-[var(--text-muted)] mt-1">{flag.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subcommands */}
      {subcommands && subcommands.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Subcommands</h2>
          <div className="grid gap-2">
            {subcommands.map((sub, i) => (
              <Link
                key={i}
                to={sub.href}
                className="flex items-center justify-between p-4 rounded-2xl transition-all"
                style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-flat)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-raised)' }}
              >
                <div>
                  <code className="text-sm font-mono text-[var(--brand-primary)]">{sub.name}</code>
                  <p className="text-sm text-[var(--text-muted)] mt-1">{sub.description}</p>
                </div>
                <ArrowLeft size={16} className="text-[var(--text-muted)] rotate-180" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Examples */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Examples</h2>
        <div className="space-y-6">
          {examples.map((ex, i) => (
            <div key={i} className="space-y-2">
              <p className="text-[var(--text-secondary)]">{ex.description}</p>
              <CodeBlock code={ex.code} output={ex.output} />
            </div>
          ))}
        </div>
      </div>

      {/* See Also */}
      {seeAlso && seeAlso.length > 0 && (
        <div className="space-y-3 pt-6 border-t border-[var(--border-subtle)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">See Also</h2>
          <div className="flex flex-wrap gap-2">
            {seeAlso.map((item, i) => (
              <Link
                key={i}
                to={item.href}
                className="px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all"
                style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-flat)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)' }}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-6 border-t border-[var(--border-subtle)]">
        <Link 
          to="/docs/cli"
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          All Commands
        </Link>
        <Link 
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
        >
          SDK Reference
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
