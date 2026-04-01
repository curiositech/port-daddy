import { useState, useEffect } from 'react'
import { CodeBlock } from './CodeBlock'

interface NeumorphicTerminalProps {
  code: string
  title?: string
  language?: string
  typewriterSpeed?: number
  animate?: boolean
}

export function NeumorphicTerminal({
  code,
  title,
  language = 'bash',
  typewriterSpeed = 25,
  animate = true,
}: NeumorphicTerminalProps) {
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
    <CodeBlock language={language} filename={title}>
      {displayedCode + cursor}
    </CodeBlock>
  )
}
