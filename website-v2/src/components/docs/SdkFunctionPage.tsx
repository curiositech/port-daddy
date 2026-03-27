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

  const highlightLine = (line: string) => {
    if (!line.trim()) return <span> </span>
    if (line.startsWith('//')) return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
    if (line.startsWith('import ') || line.startsWith('export ') || line.startsWith('const ') || line.startsWith('await ') || line.startsWith('async '))
      return <span style={{ color: 'var(--code-text)' }}>{line}</span>
    return <span style={{ color: 'var(--code-output)' }}>{line}</span>
  }

  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl p-5 group"
        style={{
          background: 'var(--surface-raised)',
          boxShadow: 'var(--shadow-raised)',
        }}
      >
        <div
          className="rounded-xl overflow-hidden"
          style={{
            background: 'var(--code-bg)',
            boxShadow: 'var(--shadow-inset)',
          }}
        >
          {/* Traffic lights + copy */}
          <div
            className="flex items-center justify-between px-4 py-2.5"
            style={{ borderBottom: '1px solid var(--code-border)' }}
          >
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
            </div>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg transition-all cursor-pointer opacity-0 group-hover:opacity-100"
              style={{ color: 'var(--code-comment)' }}
            >
              {copied ? <Check size={14} style={{ color: 'var(--code-dot-green)' }} /> : <Copy size={14} />}
            </button>
          </div>

          <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
            <code className="font-mono">
              {code.split('\n').map((line, i) => (
                <div key={i}>{highlightLine(line)}</div>
              ))}
            </code>
          </pre>
        </div>
      </div>

      {output && (
        <div
          className="rounded-2xl p-5"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
        >
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--code-bg)',
              boxShadow: 'var(--shadow-inset)',
            }}
          >
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ borderBottom: '1px solid var(--code-border)' }}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
              <span className="ml-2 text-xs font-mono" style={{ color: 'var(--code-comment)' }}>output</span>
            </div>
            <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed font-mono whitespace-pre-wrap" style={{ color: 'var(--code-output)' }}>
              {output}
            </pre>
          </div>
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
        <CodeBlock code={signature} />
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
