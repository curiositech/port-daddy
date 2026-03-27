import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { DocsCodeBlock as CodeBlock } from './DocsCodeBlock'

interface SdkFunctionPageProps {
  function: string
  description: string
  module: string
  version: string
  signature: string
  params?: Array<{
    name: string
    type: string
    required?: boolean
    description: string
  }>
  returns?: {
    type: string
    description: string
  }
  examples: Array<{
    description: string
    code: string
    output?: string
  }>
  seeAlso?: Array<{
    name: string
    href: string
  }>
}

export function SdkFunctionPage({
  function: fn,
  description,
  module,
  version,
  signature,
  params,
  returns,
  examples,
  seeAlso
}: SdkFunctionPageProps) {
  return (
    <div className="space-y-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link to="/docs/sdk" className="hover:text-[var(--text-primary)]">SDK</Link>
        <span>/</span>
        <Link to={`/docs/sdk/${module.toLowerCase()}`} className="hover:text-[var(--text-primary)]">{module}</Link>
        <span>/</span>
        <span className="text-[var(--text-primary)]">{fn}()</span>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Badge variant="teal">SDK</Badge>
          <Badge variant="default">v{version}</Badge>
        </div>
        <h1 className="text-4xl font-semibold text-[var(--text-primary)] tracking-tight font-mono">
          {fn}()
        </h1>
        <p className="text-xl text-[var(--text-secondary)] leading-relaxed">
          {description}
        </p>
      </div>

      {/* Signature */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Signature</h2>
        <CodeBlock code={signature} language="typescript" />
      </div>

      {/* Parameters */}
      {params && params.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h2>
          <div
            className="rounded-2xl overflow-hidden divide-y divide-[var(--border-subtle)]"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
            {params.map((param, i) => (
              <div key={i} className="p-4">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-[var(--brand-primary)]">{param.name}</code>
                  {param.required && <Badge variant="default" size="sm">required</Badge>}
                  <span className="text-xs text-[var(--text-muted)]">{param.type}</span>
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-1">{param.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Returns */}
      {returns && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Returns</h2>
          <div
            className="p-5 rounded-2xl"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
            <code className="text-sm font-mono text-[var(--brand-primary)]">{returns.type}</code>
            <p className="text-sm text-[var(--text-muted)] mt-1">{returns.description}</p>
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
              <CodeBlock code={ex.code} output={ex.output} language="typescript" />
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
          to={`/docs/sdk/${module.toLowerCase()}`}
          className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          {module} Module
        </Link>
        <Link 
          to="/docs/sdk"
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-colors"
        >
          All SDK Functions
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
