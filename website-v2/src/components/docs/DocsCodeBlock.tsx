import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface DocsCodeBlockProps {
  code: string
  output?: string
  language?: 'bash' | 'typescript'
}

function highlightBashLine(line: string) {
  if (!line.trim()) return <span> </span>
  if (line.startsWith('#')) return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
  if (line.startsWith('$') || line.startsWith('pd ')) {
    const cmd = line.startsWith('$') ? line.slice(2) : line
    const prefix = line.startsWith('$') ? '$ ' : ''
    return (
      <>
        {prefix && <span style={{ color: 'var(--code-prompt)' }}>{prefix}</span>}
        <span style={{ color: 'var(--code-text)' }}>{cmd}</span>
      </>
    )
  }
  if (line.includes('ready') || line.includes('complete') || line.includes('passed') || line.includes('claimed') || line.includes('success'))
    return <span style={{ color: 'var(--code-dot-green)' }}>{line}</span>
  if (line.includes('WARNING') || line.includes('warning'))
    return <span style={{ color: 'var(--code-dot-amber)' }}>{line}</span>
  if (line.includes('ERROR') || line.includes('error'))
    return <span style={{ color: 'var(--code-dot-red)' }}>{line}</span>
  return <span style={{ color: 'var(--code-output)' }}>{line}</span>
}

function highlightTypeScriptLine(line: string) {
  if (!line.trim()) return <span> </span>
  if (line.trimStart().startsWith('//')) return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
  if (/^\s*(import |export |const |await |async )/.test(line))
    return <span style={{ color: 'var(--code-text)' }}>{line}</span>
  return <span style={{ color: 'var(--code-output)' }}>{line}</span>
}

export function DocsCodeBlock({ code, output, language = 'bash' }: DocsCodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const highlightLine = language === 'typescript' ? highlightTypeScriptLine : highlightBashLine

  return (
    <div className="group">
      {/* Recessed screen — thin bevel, no bg color */}
      <div
        className="rounded-[var(--radius-xl)] overflow-hidden"
        style={{ boxShadow: 'inset 1px 1px 3px var(--neu-shadow), inset -1px -1px 3px var(--neu-highlight)' }}
      >
        <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid var(--code-border)' }}>
          <div className="flex items-center gap-2" aria-hidden="true">
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
          </div>
          <button
            onClick={handleCopy}
            className="p-1.5 rounded-lg transition-all cursor-pointer opacity-0 group-hover:opacity-100"
            style={{ color: 'var(--code-comment)' }}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check size={14} style={{ color: 'var(--code-dot-green)' }} /> : <Copy size={14} />}
          </button>
          <span className="sr-only" aria-live="polite">{copied ? "Code copied to clipboard" : ""}</span>
        </div>

        <pre className="overflow-x-auto px-3 py-2 m-0 text-sm leading-relaxed"><code className="font-mono">{code.trim().split('\n').map((line, i) => (
              <div key={i}>{highlightLine(line)}</div>
            ))}</code></pre>
      </div>

      {output && (
        <div
          className="rounded-[var(--radius-xl)] overflow-hidden mt-3"
          style={{ boxShadow: 'inset 1px 1px 3px var(--neu-shadow), inset -1px -1px 3px var(--neu-highlight)' }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--code-border)' }}>
            <div className="flex items-center gap-2" aria-hidden="true">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
            </div>
            <span className="ml-2 text-xs font-mono" style={{ color: 'var(--code-comment)' }}>output</span>
          </div>
          <pre className="overflow-x-auto px-3 py-2 m-0 text-sm leading-relaxed font-mono whitespace-pre-wrap" style={{ color: 'var(--code-output)' }}>{output?.trim()}</pre>
        </div>
      )}
    </div>
  )
}
