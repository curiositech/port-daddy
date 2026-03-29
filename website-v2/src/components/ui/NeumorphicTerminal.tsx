import { useState, useEffect } from 'react'
import { Copy, Check, Terminal } from 'lucide-react'
import { Surface } from './Surface'

interface NeumorphicTerminalProps {
  code: string
  title?: string
  language?: string
  typewriterSpeed?: number
}

export function NeumorphicTerminal({
  code,
  title = 'terminal',
  language = 'bash',
  typewriterSpeed = 25,
}: NeumorphicTerminalProps) {
  const [copied, setCopied] = useState(false)
  const [displayedCode, setDisplayedCode] = useState('')
  const [isTyping, setIsTyping] = useState(true)

  useEffect(() => {
    const trimmed = code.trim()
    let currentIndex = 0
    setDisplayedCode('')
    setIsTyping(true)

    const interval = setInterval(() => {
      if (currentIndex < trimmed.length) {
        setDisplayedCode(trimmed.slice(0, currentIndex + 1))
        currentIndex++
      } else {
        setIsTyping(false)
        clearInterval(interval)
      }
    }, typewriterSpeed)

    return () => clearInterval(interval)
  }, [code, typewriterSpeed])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* */ }
  }

  const highlightBash = (line: string) => {
    if (!line.trim()) return <span>{'\u00A0'}</span>
    if (line.startsWith('#')) return <span className="text-[var(--code-comment)]">{line}</span>
    if (line.startsWith('$')) {
      const cmd = line.slice(2)
      return (
        <>
          <span className="text-[var(--code-prompt)]">$ </span>
          <span className="text-[var(--code-text)]">{cmd}</span>
        </>
      )
    }
    if (line.includes('ready') || line.includes('complete') || line.includes('passed') || line.includes('claimed'))
      return <span className="text-[var(--code-dot-green)]">{line}</span>
    if (line.includes('WARNING') || line.includes('warning'))
      return <span className="text-[var(--code-dot-amber)]">{line}</span>
    if (line.includes('ERROR') || line.includes('error'))
      return <span className="text-[var(--code-dot-red)]">{line}</span>
    return <span className="text-[var(--code-output)]">{line}</span>
  }

  // Trim leading/trailing empty lines from displayed code
  const lines = displayedCode.split('\n').filter((line, i, arr) => {
    // Drop leading empty lines
    if (i === 0 && !line.trim()) return false
    // Drop trailing empty lines
    if (i === arr.length - 1 && !line.trim()) return false
    return true
  })

  return (
    <Surface depth="raised" radius="2xl" padding="lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Surface depth="inset" radius="lg" padding="none" className="w-10 h-10 flex items-center justify-center">
            <Terminal size={18} className="text-[var(--brand-primary)]" />
          </Surface>
          <div>
            <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
            <span className="text-xs text-[var(--text-muted)] ml-2">{language}</span>
          </div>
        </div>

        <button
          onClick={handleCopy}
          className="w-11 h-11 rounded-[var(--radius-lg)] flex items-center justify-center transition-all duration-200 cursor-pointer"
          style={{
            background: 'var(--surface-base)',
            boxShadow: 'var(--shadow-sm)',
          }}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check size={14} className="text-[var(--status-success)]" />
          ) : (
            <Copy size={14} className="text-[var(--text-muted)]" />
          )}
        </button>
        <span className="sr-only" aria-live="polite">{copied ? "Code copied to clipboard" : ""}</span>
      </div>

      {/* Recessed screen — thin bevel, no bg color */}
      <div
        className="rounded-[var(--radius-lg)] overflow-hidden"
        style={{ boxShadow: 'inset 1px 1px 3px var(--neu-shadow), inset -1px -1px 3px var(--neu-highlight)' }}
      >
        <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--code-border)' }} aria-hidden="true">
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
          <div className="w-2 h-2 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
        </div>

        <div className="font-mono text-sm leading-relaxed overflow-x-auto px-3 py-2">
          {lines.map((line, i) => (
            <div key={i} className="py-0.5">
              {highlightBash(line)}
              {i === lines.length - 1 && isTyping && (
                <span className="animate-pulse text-[var(--brand-primary)]">|</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </Surface>
  )
}
