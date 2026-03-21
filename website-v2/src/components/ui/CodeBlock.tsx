import { motion } from 'framer-motion';
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
    <motion.div
      className={cn(
        'rounded-lg overflow-hidden',
        className
      )}
      style={{
        background: 'var(--codeblock-bg)',
        border: '1px solid var(--codeblock-border)',
      }}
    >
      {/* Header */}
      <motion.div
        className="flex items-center justify-between px-4 py-2"
        style={{
          background: 'var(--codeblock-header-bg)',
          borderBottom: '1px solid var(--codeblock-border)',
        }}
      >
        <motion.div className="flex items-center gap-3">
          {/* Traffic lights */}
          <motion.div className="flex gap-1.5">
            <motion.span className="w-3 h-3 rounded-full" style={{ background: 'var(--codeblock-dot-red)' }} />
            <motion.span className="w-3 h-3 rounded-full" style={{ background: 'var(--codeblock-dot-amber)' }} />
            <motion.span className="w-3 h-3 rounded-full" style={{ background: 'var(--codeblock-dot-green)' }} />
          </motion.div>
          {filename && (
            <motion.span className="text-xs font-mono" style={{ color: 'var(--codeblock-filename)' }}>{filename}</motion.span>
          )}
          {language && !filename && (
            <motion.span className="text-xs font-mono uppercase tracking-wider" style={{ color: 'var(--codeblock-filename)' }}>
              {language}
            </motion.span>
          )}
        </motion.div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="text-xs transition-colors px-2 py-1 rounded"
            style={{ color: copied ? 'var(--codeblock-dot-green)' : 'var(--codeblock-copy)' }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--codeblock-copy-hover)' }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--codeblock-copy)' }}
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </motion.div>

      {/* Code body */}
      <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
        <code className="font-mono" style={{ color: 'var(--codeblock-text)' }}>{children}</code>
      </pre>
    </motion.div>
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
    <motion.div className={cn('font-mono text-sm leading-relaxed', className)}>
      {command !== undefined && (
        <motion.div>
          <motion.span style={{ color: 'var(--code-prompt)' }}>{prompt} </motion.span>
          <motion.span style={{ color: 'var(--codeblock-text)' }}>{command}</motion.span>
        </motion.div>
      )}
      {output !== undefined && (
        <motion.div className="pl-4" style={{ color: 'var(--code-output)' }}>{output}</motion.div>
      )}
    </motion.div>
  )
}
