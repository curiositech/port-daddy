import * as React from 'react'
import { cn } from '@/lib/utils'

interface CodeBlockProps {
  children: React.ReactNode
  language?: string
  filename?: string
  className?: string
  /** If true, show a copy button */
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

  return (
    <div
      className={cn(
        'bg-[var(--codeblock-bg)] border border-[var(--codeblock-border)]',
        'rounded-[var(--codeblock-radius)]',
        'overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--codeblock-header-bg)] border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-[var(--p-red-500)] opacity-70" />
            <span className="w-3 h-3 rounded-full bg-[var(--p-amber-500)] opacity-70" />
            <span className="w-3 h-3 rounded-full bg-[var(--p-green-500)] opacity-70" />
          </div>
          {filename && (
            <span className="text-xs text-[var(--text-muted)] font-mono">{filename}</span>
          )}
          {language && !filename && (
            <span className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1 rounded hover:bg-[var(--interactive-hover)]"
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>

      {/* Code body */}
      <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
        <code className="text-[var(--code-output)] font-mono">{children}</code>
      </pre>
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
          <span className="text-[var(--code-prompt)]">{prompt} </span>
          <span className="text-[var(--text-primary)]">{command}</span>
        </div>
      )}
      {output !== undefined && (
        <div className="text-[var(--code-output)] pl-4">{output}</div>
      )}
    </div>
  )
}
