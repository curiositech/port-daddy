import * as React from 'react'
import { cn } from '@/lib/utils'
import { Surface } from './Surface'
import { Copy, Check, Terminal, FileCode } from 'lucide-react'

interface CodeBlockProps {
  children: React.ReactNode
  language?: string
  filename?: string
  className?: string
  copyable?: boolean
}

export function CodeBlock({ children, language, filename, className, copyable = true }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false)

  const handleCopy = () => {
    const text = typeof children === 'string' ? children : ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const Icon = filename ? FileCode : Terminal

  return (
    <Surface depth="raised" radius="2xl" padding="sm" className={cn('transition-all duration-300', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Surface depth="inset" radius="lg" padding="none" className="w-7 h-7 flex items-center justify-center">
            <Icon size={12} className="text-[var(--brand-primary)]" />
          </Surface>
          {filename && (
            <span className="text-xs font-mono text-[var(--text-muted)]">{filename}</span>
          )}
          {language && !filename && (
            <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider">{language}</span>
          )}
        </div>
        {copyable && (
          <>
            <button
              onClick={handleCopy}
              className="w-8 h-8 rounded-[var(--radius-lg)] flex items-center justify-center transition-all duration-200 cursor-pointer"
              style={{
                background: 'var(--surface-base)',
                boxShadow: 'var(--shadow-sm)',
              }}
              aria-label={copied ? "Copied" : "Copy code"}
            >
              {copied ? (
                <Check size={12} className="text-[var(--code-dot-green)]" />
              ) : (
                <Copy size={12} className="text-[var(--text-muted)]" />
              )}
            </button>
            <span className="sr-only" aria-live="polite">{copied ? "Code copied to clipboard" : ""}</span>
          </>
        )}
      </div>

      {/* Recessed screen — thin bevel, no bg color */}
      <div
        className="rounded-[var(--radius-sm)] overflow-hidden"
        style={{ boxShadow: 'inset 1px 1px 3px var(--neu-shadow), inset -1px -1px 3px var(--neu-highlight)' }}
      >
        <div className="flex items-center gap-1.5 px-2.5 py-1" style={{ borderBottom: '1px solid var(--code-border)' }} aria-hidden="true">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
        </div>
        <pre className="overflow-x-auto px-2.5 py-1.5 m-0 text-sm leading-normal"><code className="font-mono" style={{ color: 'var(--code-text)' }}>{typeof children === 'string' ? children.trim() : children}</code></pre>
      </div>
    </Surface>
  )
}

interface TerminalLineProps {
  prompt?: string
  command?: string
  output?: string
  className?: string
}

export function TerminalLine({ prompt = '$', command, output, className }: TerminalLineProps) {
  return (
    <div className={cn('font-mono text-sm leading-relaxed', className)}>
      {command !== undefined && (
        <div>
          <span style={{ color: 'var(--code-prompt)' }}>{prompt} </span>
          <span style={{ color: 'var(--code-text)' }}>{command}</span>
        </div>
      )}
      {output !== undefined && (
        <div className="pl-4" style={{ color: 'var(--code-output)' }}>{output}</div>
      )}
    </div>
  )
}
