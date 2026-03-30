import * as React from 'react'
import { cn } from '@/lib/utils'
import { Copy, Check } from 'lucide-react'

/* ── Syntax highlighting ──────────────────────────────────────────────────── */

function highlightBash(line: string): React.ReactNode {
  if (!line.trim()) return '\u00A0'
  if (line.trimStart().startsWith('#'))
    return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
  if (line.trimStart().startsWith('$')) {
    const indent = line.match(/^(\s*)/)?.[1] ?? ''
    const rest = line.trimStart().slice(2)
    return <>{indent}<span style={{ color: 'var(--code-prompt)', fontWeight: 600 }}>$ </span>{highlightArgs(rest)}</>
  }
  return <span style={{ color: 'var(--code-output)' }}>{line}</span>
}

function highlightArgs(text: string): React.ReactNode {
  const tokens: React.ReactNode[] = []
  const regex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(--?[\w-]+)|(&&|\||;)|(\S+)/g
  let m: RegExpExecArray | null
  let lastIndex = 0
  let isFirst = true

  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) tokens.push(text.slice(lastIndex, m.index))
    lastIndex = m.index + m[0].length
    const [full, str, flag, op, word] = m
    if (str)
      tokens.push(<span key={m.index} style={{ color: 'var(--code-string)' }}>{full}</span>)
    else if (flag)
      tokens.push(<span key={m.index} style={{ color: 'var(--code-flag)' }}>{full}</span>)
    else if (op) {
      tokens.push(<span key={m.index} style={{ color: 'var(--code-comment)' }}>{full}</span>)
      isFirst = true
    } else if (word) {
      if (isFirst)
        tokens.push(<span key={m.index} style={{ color: 'var(--code-command)', fontWeight: 600 }}>{full}</span>)
      else
        tokens.push(<span key={m.index} style={{ color: 'var(--code-text)' }}>{full}</span>)
    }
    if (word || str) isFirst = false
  }
  if (lastIndex < text.length) tokens.push(text.slice(lastIndex))
  return <>{tokens}</>
}

function highlightTS(line: string): React.ReactNode {
  if (!line.trim()) return '\u00A0'
  if (line.trimStart().startsWith('//'))
    return <span style={{ color: 'var(--code-comment)' }}>{line}</span>
  const parts: React.ReactNode[] = []
  const kwRegex = /\b(import|export|from|const|let|var|async|await|function|return|if|else|new|typeof|class|interface|type)\b/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = kwRegex.exec(line)) !== null) {
    if (m.index > last) parts.push(highlightTSStrings(line.slice(last, m.index)))
    parts.push(<span key={m.index} style={{ color: 'var(--code-command)', fontWeight: 600 }}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < line.length) parts.push(highlightTSStrings(line.slice(last)))
  return <>{parts}</>
}

function highlightTSStrings(text: string): React.ReactNode {
  const strRegex = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = strRegex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<span key={m.index} style={{ color: 'var(--code-string)' }}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

/* ── Component ───────────────────────────────────────────────────────────── */

interface CodeBlockProps {
  children: React.ReactNode
  language?: string
  filename?: string
  className?: string
  copyable?: boolean
}

export function CodeBlock({ children, language, filename, className, copyable = true }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false)

  // Extract text content from children, handling JSX whitespace nodes
  const textContent = React.Children.toArray(children)
    .map(c => (typeof c === 'string' ? c : ''))
    .join('')
    .trim()

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div
      className={cn('rounded-[var(--radius-md)] overflow-hidden relative group', className)}
      style={{ boxShadow: 'inset 1px 1px 3px var(--neu-shadow), inset -1px -1px 3px var(--neu-highlight)' }}
    >
      {/* Compact header: dots + filename + copy */}
      <div className="flex items-center gap-1.5 px-3 py-1.5" style={{ borderBottom: '1px solid var(--code-border)' }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-red)' }} aria-hidden="true" />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-amber)' }} aria-hidden="true" />
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--code-dot-green)' }} aria-hidden="true" />
        {(filename || language) && (
          <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{filename || language}</span>
        )}
        {copyable && (
          <button
            onClick={handleCopy}
            className="ml-auto w-6 h-6 rounded-md flex items-center justify-center transition-opacity duration-150 opacity-0 group-hover:opacity-100 cursor-pointer"
            style={{ background: 'var(--surface-base)' }}
            aria-label={copied ? "Copied" : "Copy code"}
          >
            {copied ? <Check size={10} className="text-[var(--code-dot-green)]" /> : <Copy size={10} className="text-[var(--text-muted)]" />}
          </button>
        )}
        <span className="sr-only" aria-live="polite">{copied ? "Code copied to clipboard" : ""}</span>
      </div>

      {/* Code */}
      <pre className="overflow-x-auto px-3 py-2 m-0 text-[13px] leading-snug font-mono" style={{ color: 'var(--code-text)' }}>{
        language === 'bash' || language === 'shell' || !language
          ? textContent.split('\n').map((line, i) => <div key={i}>{highlightBash(line)}</div>)
          : language === 'typescript' || language === 'javascript'
          ? textContent.split('\n').map((line, i) => <div key={i}>{highlightTS(line)}</div>)
          : textContent
      }</pre>
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
          <span style={{ color: 'var(--code-text)' }}>{command}</span>
        </div>
      )}
      {output !== undefined && (
        <div className="pl-4" style={{ color: 'var(--code-output)' }}>{output}</div>
      )}
    </div>
  )
}
