import { useState, useEffect } from 'react'
import { CodeBlock } from './CodeBlock'

interface CommandTerminalProps {
  code: string
  title?: string
  language?: string
  typewriterSpeed?: number
  animate?: boolean
  copyable?: boolean
}

export function CommandTerminal({
  code,
  title,
  language = 'bash',
  typewriterSpeed = 25,
  animate = true,
  copyable = true,
}: CommandTerminalProps) {
  const trimmed = code.trim()
  const [displayedCode, setDisplayedCode] = useState(animate ? '' : trimmed)
  const [isTyping, setIsTyping] = useState(animate)

  useEffect(() => {
    if (!animate) return
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
  }, [trimmed, typewriterSpeed, animate])

  const cursor = isTyping ? '|' : ''

  return (
    <CodeBlock language={language} filename={title} copyable={copyable}>
      {displayedCode + cursor}
    </CodeBlock>
  )
}
