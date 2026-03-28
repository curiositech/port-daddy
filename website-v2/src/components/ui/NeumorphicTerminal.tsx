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
    let currentIndex = 0
    setDisplayedCode('')
    setIsTyping(true)

    const interval = setInterval(() => {
      if (currentIndex < code.length) {
        setDisplayedCode(code.slice(0, currentIndex + 1))
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
    if (!line.trim()) return <span> </span>
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

  const lines = displayedCode.split('\n')

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
          className="w-9 h-9 rounded-[var(--radius-lg)] flex items-center justify-center transition-all duration-200 cursor-pointer"
          style={{
            background: 'var(--surface-base)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {copied ? (
            <Check size={14} className="text-[var(--status-success)]" />
          ) : (
            <Copy size={14} className="text-[var(--text-muted)]" />
          )}
        </button>
      </div>

      {/* Terminal body */}
      <div
        className="rounded-[var(--radius-lg)] p-5 overflow-x-auto"
        style={{
          background: 'var(--code-bg)',
          boxShadow: 'var(--shadow-inset)',
        }}
      >
        <div className="flex items-center gap-2 mb-3 pb-2" style={{ borderBottom: '1px solid var(--code-border)' }}>
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-red)' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-amber)' }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--code-dot-green)' }} />
        </div>

        <div className="font-mono text-sm leading-relaxed">
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
