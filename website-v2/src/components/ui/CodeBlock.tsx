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
        'bg-muted border border-border',
        'rounded-lg',
        'overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <motion.div className="flex items-center justify-between px-4 py-2 bg-muted/80 border-b border-border">
        <motion.div className="flex items-center gap-3">
          {/* Traffic lights */}
          <motion.div className="flex gap-1.5">
            <motion.span className="w-3 h-3 rounded-full bg-red-500 opacity-70" />
            <motion.span className="w-3 h-3 rounded-full bg-amber-500 opacity-70" />
            <motion.span className="w-3 h-3 rounded-full bg-green-500 opacity-70" />
          </motion.div>
          {filename && (
            <motion.span className="text-xs text-muted-foreground font-mono">{filename}</motion.span>
          )}
          {language && !filename && (
            <motion.span className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
              {language}
            </motion.span>
          )}
        </motion.div>
        {copyable && (
          <button
            onClick={handleCopy}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-accent"
            aria-label="Copy code"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        )}
      </motion.div>

      {/* Code body */}
      <pre className="overflow-x-auto p-4 m-0 text-sm leading-relaxed">
        <code className="text-foreground font-mono">{children}</code>
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
          <motion.span className="text-primary">{prompt} </motion.span>
          <motion.span className="text-foreground">{command}</motion.span>
        </motion.div>
      )}
      {output !== undefined && (
        <motion.div className="text-muted-foreground pl-4">{output}</motion.div>
      )}
    </motion.div>
  )
}
