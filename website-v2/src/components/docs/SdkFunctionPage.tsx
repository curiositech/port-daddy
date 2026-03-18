import { Badge } from '@/components/ui/Badge'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, Check } from 'lucide-react'
import { useState } from 'react'

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

function CodeBlock({ code, output }: { code: string; output?: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="relative p-4 rounded-lg bg-[var(--bg-code)] border border-[var(--border-subtle)] font-mono text-sm group">
        <button
          onClick={handleCopy}
          className="absolute right-3 top-3 p-1.5 rounded hover:bg-[var(--interactive-hover)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {copied ? <Check size={14} className="text-[var(--success)]" /> : <Copy size={14} />}
        </button>
        <code className="text-[var(--brand-primary)]">{code}</code>
      </div>
      {output && (
        <div className="p-4 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] font-mono text-sm">
          <div className="text-[var(--text-muted)] mb-1 text-xs uppercase tracking-wide">Output</div>
          <pre className="text-[var(--text-secondary)] whitespace-pre-wrap">{output}</pre>
        </div>
      )}
    </div>
  )
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
          <Badge variant="neutral">v{version}</Badge>
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
        <CodeBlock code={signature} />
      </div>

      {/* Parameters */}
      {params && params.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Parameters</h2>
          <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl overflow-hidden">
            {params.map((param, i) => (
              <div key={i} className="p-4 bg-[var(--bg-surface)]">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono text-[var(--brand-primary)]">{param.name}</code>
                  {param.required && <Badge variant="neutral" size="sm">required</Badge>}
                  <span className="text-xs text-[var(--text-muted)]">{param.type}</span>
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mt-1">{param.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Returns */}
      {returns && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Returns</h2>
          <div className="p-4 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
            <code className="text-sm font-mono text-[var(--brand-primary)]">{returns.type}</code>
            <p className="text-sm text-[var(--text-tertiary)] mt-1">{returns.description}</p>
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
                className="px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)] transition-colors"
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
          className="flex items-center gap-2 text-sm text-[var(--brand-primary)] hover:text-[var(--brand-primary-hover)] transition-colors"
        >
          All SDK Functions
          <ArrowLeft size={14} className="rotate-180" />
        </Link>
      </div>
    </div>
  )
}
