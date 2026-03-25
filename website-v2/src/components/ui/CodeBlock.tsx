import * as React from 'react'
import { cn } from '@/lib/utils'
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
    <div
      className={cn('rounded-2xl p-5 transition-all duration-300', className)}
      style={{
        background: 'var(--bg-surface)',
        boxShadow: 'var(--shadow-neu-raised)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: 'var(--bg-base)',
              boxShadow: 'var(--shadow-neu-inset)',
            }}
          >
            <Icon size={14} className="text-[var(--brand-primary)]" />
          </div>
          {filename && (
            <span className="text-xs font-mono text-[var(--text-muted)]">{filename}</span>
          )}
          {language && !filename && (
            <span className="text-xs font-mono text-[var(--text-muted)] uppercase tracking-wider">{language}</span>
          )}
        </div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 cursor-pointer"
            style={{
              background: 'var(--bg-base)',
              boxShadow: 'var(--shadow-neu-sm)',
            }}
            aria-label="Copy code"
          >
            {copied ? (
              <Check size={12} className="text-[var(--codeblock-dot-green)]" />
            ) : (
              <Copy size={12} className="text-[var(--text-muted)]" />
            )}
          </button>
        )}
      </div>

      {/* Code body — always dark, inset */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'var(--bg-code)',
          boxShadow: 'var(--shadow-neu-inset)',
        }}
      >
        {/* Traffic lights */}
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{ borderBottom: '1px solid var(--codeblock-border)' }}
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--codeblock-dot-red)' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--codeblock-dot-amber)' }} />
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--codeblock-dot-green)' }} />
        </div>

        <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
          <code className="font-mono" style={{ color: 'var(--codeblock-text)' }}>{children}</code>
        </pre>
      </div>
    </div>
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
          <span style={{ color: 'var(--codeblock-text)' }}>{command}</span>
        </div>
      )}
      {output !== undefined && (
        <div className="pl-4" style={{ color: 'var(--code-output)' }}>{output}</div>
      )}
    </div>
  )
}
