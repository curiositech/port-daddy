import { useState, useEffect } from 'react'
import { CodeBlock } from './CodeBlock'

interface NeumorphicTerminalProps {
  code: string
  title?: string
  language?: string
  typewriterSpeed?: number
}

export function NeumorphicTerminal({
  code,
  title,
  language = 'bash',
  typewriterSpeed = 25,
}: NeumorphicTerminalProps) {
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

  const cursor = isTyping ? '|' : ''

  return (
    <CodeBlock language={language} filename={title}>
      {displayedCode + cursor}
    </CodeBlock>
  )
}
