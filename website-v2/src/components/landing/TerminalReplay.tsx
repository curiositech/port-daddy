import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

interface ReplayStep {
  type: 'command' | 'output' | 'comment' | 'blank'
  text: string
  delay?: number  // ms to wait before this line appears
}

const REPLAY_SCRIPT: ReplayStep[] = [
  { type: 'comment', text: '# Two agents, one project, zero collisions' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd begin --identity myapp:api --purpose "Refactor auth module"' },
  { type: 'output', text: '⚓ Session started · myapp:api · agent-7f3a' },
  { type: 'output', text: '  No dead agents in myapp:* — clear skies' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd files claim session-7f3a src/auth/*.ts' },
  { type: 'output', text: '✓ Claimed 4 files · no conflicts' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd note "Extracted JWT middleware, tests green"' },
  { type: 'output', text: '✓ Note recorded · 12:04:38' },
  { type: 'blank', text: '' },
  { type: 'comment', text: '# Meanwhile, Agent 2 arrives...' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd begin --identity myapp:frontend --purpose "Wire auth UI"' },
  { type: 'output', text: '⚓ Session started · myapp:frontend · agent-9c2b' },
  { type: 'output', text: '  ⚠ 1 agent active in myapp:* → agent-7f3a owns src/auth/*.ts' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd files claim session-9c2b src/components/LoginForm.tsx' },
  { type: 'output', text: '✓ Claimed · no conflicts (different files)' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd msg myapp:events publish "auth-api ready"' },
  { type: 'output', text: '✓ Published → 1 subscriber notified' },
  { type: 'blank', text: '' },
  { type: 'comment', text: '# Agent 1 receives the signal and wraps up' },
  { type: 'blank', text: '' },
  { type: 'command', text: 'pd done' },
  { type: 'output', text: '⚓ Session complete · 23 notes · 4 files released' },
]

const CHAR_SPEED = 25  // ms per char for commands
const LINE_DELAY = 400  // ms between lines

export function TerminalReplay() {
  const [visibleLines, setVisibleLines] = React.useState<Array<{ step: ReplayStep; typed: string }>>([])
  const [currentLineIdx, setCurrentLineIdx] = React.useState(0)
  const [isTyping, setIsTyping] = React.useState(false)
  const [done, setDone] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [visibleLines])

  // Drive the replay
  React.useEffect(() => {
    if (currentLineIdx >= REPLAY_SCRIPT.length) {
      setDone(true)
      return
    }

    const step = REPLAY_SCRIPT[currentLineIdx]
    const isCommand = step.type === 'command'

    // Delay before showing this line
    const startDelay = step.delay ?? LINE_DELAY

    const t1 = setTimeout(() => {
      if (isCommand) {
        // Type character by character
        setIsTyping(true)
        setVisibleLines(prev => [...prev, { step, typed: '' }])

        let charIdx = 0
        const typeInterval = setInterval(() => {
          charIdx++
          setVisibleLines(prev => {
            const next = [...prev]
            next[next.length - 1] = { step, typed: step.text.slice(0, charIdx) }
            return next
          })
          if (charIdx >= step.text.length) {
            clearInterval(typeInterval)
            setIsTyping(false)
            setCurrentLineIdx(i => i + 1)
          }
        }, CHAR_SPEED)
      } else {
        setVisibleLines(prev => [...prev, { step, typed: step.text }])
        setCurrentLineIdx(i => i + 1)
      }
    }, isTyping ? 0 : startDelay)

    return () => clearTimeout(t1)
  }, [currentLineIdx, isTyping])

  const restart = () => {
    setVisibleLines([])
    setCurrentLineIdx(0)
    setDone(false)
    setIsTyping(false)
  }

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{
        background: 'var(--codeblock-bg)',
        borderColor: 'var(--border-default)',
        boxShadow: 'var(--p-shadow-xl)',
      }}
    >
      {/* Terminal header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{
          background: 'var(--codeblock-header-bg)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-red-500)', opacity: 0.7 }} />
            <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-amber-500)', opacity: 0.7 }} />
            <span className="w-3 h-3 rounded-full" style={{ background: 'var(--p-green-500)', opacity: 0.7 }} />
          </div>
          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            zsh — port-daddy demo
          </span>
        </div>
        {done && (
          <button
            onClick={restart}
            className="text-xs px-2 py-1 rounded transition-colors"
            style={{ color: 'var(--brand-primary)', background: 'var(--badge-teal-bg)' }}
          >
            Replay
          </button>
        )}
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        className="overflow-y-auto p-4 font-mono text-sm leading-relaxed"
        style={{ minHeight: '320px', maxHeight: '420px', color: 'var(--code-output)' }}
      >
        <AnimatePresence initial={false}>
          {visibleLines.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <TerminalLine step={line.step} text={line.typed} isLast={i === visibleLines.length - 1 && isTyping} />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Cursor when not typing a command */}
        {!isTyping && !done && (
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--code-prompt)' }}>$</span>
            <BlinkCursor />
          </div>
        )}
      </div>
    </div>
  )
}

function TerminalLine({ step, text, isLast }: { step: ReplayStep; text: string; isLast: boolean }) {
  if (step.type === 'blank') return <div className="h-3" />

  if (step.type === 'comment') {
    return (
      <div style={{ color: 'var(--code-comment)' }} className="select-none">
        {text}
      </div>
    )
  }

  if (step.type === 'command') {
    return (
      <div className="flex items-start gap-2">
        <span style={{ color: 'var(--code-prompt)', flexShrink: 0 }}>$</span>
        <span style={{ color: 'var(--text-primary)' }}>
          {text}
          {isLast && <BlinkCursor />}
        </span>
      </div>
    )
  }

  // output
  return (
    <div
      style={{ color: 'var(--code-output)' }}
      className={cn('pl-4', text.includes('⚠') ? '' : '')}
    >
      <span style={text.includes('⚠') ? { color: 'var(--status-warning)' } : {}}>
        {text}
      </span>
    </div>
  )
}

function BlinkCursor() {
  return (
    <motion.span
      animate={{ opacity: [1, 0] }}
      transition={{ duration: 0.6, repeat: Infinity, repeatType: 'reverse' }}
      style={{ display: 'inline-block', width: '8px', height: '1em', background: 'var(--brand-primary)', verticalAlign: 'text-bottom', marginLeft: '2px' }}
    />
  )
}
