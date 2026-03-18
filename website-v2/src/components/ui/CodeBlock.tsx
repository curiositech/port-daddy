import { motion, AnimatePresence } from 'framer-motion';
import * as React from 'react'
import { cn } from '@/lib/utils'
import { Copy, Check } from 'lucide-react'

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
        'bg-[var(--codeblock-bg)] border border-[var(--codeblock-border)]',
        'rounded-[var(--codeblock-radius)]',
        'overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <motion.div className="flex items-center justify-between px-4 py-2 bg-[var(--codeblock-header-bg)] border-b border-[var(--border-subtle)]">
        <motion.div className="flex items-center gap-3">
          {/* Traffic lights */}
          <motion.div className="flex gap-1.5">
            <motion.span className="w-3 h-3 rounded-full bg-[var(--p-red-500)] opacity-70" />
            <motion.span className="w-3 h-3 rounded-full bg-[var(--p-amber-500)] opacity-70" />
            <motion.span className="w-3 h-3 rounded-full bg-[var(--p-green-500)] opacity-70" />
          </motion.div>
          {filename && (
            <motion.span className="text-xs text-[var(--text-muted)] font-mono">{filename}</motion.span>
          )}
          {language && !filename && (
            <motion.span className="text-xs text-[var(--text-muted)] font-mono uppercase tracking-wider">
              {language}
            </motion.span>
          )}
        </motion.div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all px-2 py-1.5 rounded-md hover:bg-[var(--interactive-hover)]"
            aria-label={copied ? 'Copied to clipboard' : 'Copy code to clipboard'}
            title={copied ? 'Copied!' : 'Copy code'}
          >
            <AnimatePresence mode="wait">
              {copied ? (
                <motion.span
                  key="check"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5 text-[var(--brand-primary)]"
                >
                  <Check size={14} />
                  <span>Copied!</span>
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="flex items-center gap-1.5"
                >
                  <Copy size={14} />
                  <span>Copy</span>
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        )}
      </motion.div>

      {/* Code body */}
      <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
        <code className="text-[var(--code-output)] font-mono">{children}</code>
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
          <motion.span className="text-[var(--code-prompt)]">{prompt} </motion.span>
          <motion.span className="text-[var(--text-primary)]">{command}</motion.span>
        </motion.div>
      )}
      {output !== undefined && (
        <motion.div className="text-[var(--code-output)] pl-4">{output}</motion.div>
      )}
    </motion.div>
  )
}
