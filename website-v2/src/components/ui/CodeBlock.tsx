import * as React from 'react'
import { cn } from '@/lib/utils'
import { Surface } from './Surface'
import { Copy, Check, Terminal, FileCode } from 'lucide-react'

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
        <pre className="overflow-x-auto px-2.5 py-1.5 m-0 text-sm leading-normal font-mono" style={{ color: 'var(--code-text)' }}>{
          language === 'bash' || language === 'shell' || !language
            ? textContent.split('\n').map((line, i) => <div key={i}>{highlightBash(line)}</div>)
            : language === 'typescript' || language === 'javascript'
            ? textContent.split('\n').map((line, i) => <div key={i}>{highlightTS(line)}</div>)
            : textContent
        }</pre>
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
