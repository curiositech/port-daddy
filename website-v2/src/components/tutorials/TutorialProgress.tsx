import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock, MapPin, ChevronRight, Trophy } from 'lucide-react'

interface Tutorial {
  number: number
  title: string
  href: string
  readTime: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
}

// Tutorial roadmap data
const TUTORIALS: Tutorial[] = [
  { number: 1, title: 'The First Handshake', href: '/tutorials/getting-started', readTime: '5 min', level: 'Beginner' },
  { number: 2, title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent', readTime: '8 min', level: 'Beginner' },
  { number: 3, title: 'Session Phases', href: '/tutorials/session-phases', readTime: '6 min', level: 'Beginner' },
  { number: 4, title: 'Working with Ports', href: '/tutorials/monorepo', readTime: '7 min', level: 'Beginner' },
  { number: 5, title: 'The Inbox Pattern', href: '/tutorials/inbox', readTime: '8 min', level: 'Intermediate' },
  { number: 6, title: 'Sugar & Syntax', href: '/tutorials/sugar', readTime: '5 min', level: 'Intermediate' },
  { number: 7, title: 'Always-On Avatars', href: '/tutorials/always-on', readTime: '10 min', level: 'Intermediate' },
  { number: 8, title: 'pd spawn', href: '/tutorials/pd-spawn', readTime: '8 min', level: 'Intermediate' },
  { number: 9, title: 'The Dashboard', href: '/tutorials/dashboard', readTime: '6 min', level: 'Intermediate' },
  { number: 10, title: 'Harbors', href: '/tutorials/harbors', readTime: '12 min', level: 'Intermediate' },
  { number: 11, title: 'pd watch', href: '/tutorials/watch', readTime: '7 min', level: 'Intermediate' },
  { number: 12, title: 'Time-Travel Debugging', href: '/tutorials/time-travel', readTime: '9 min', level: 'Advanced' },
  { number: 13, title: 'Pipelines', href: '/tutorials/pipelines', readTime: '11 min', level: 'Advanced' },
  { number: 14, title: 'DNS Resolver', href: '/tutorials/dns', readTime: '6 min', level: 'Advanced' },
  { number: 15, title: 'Remote Harbors', href: '/tutorials/remote-harbors', readTime: '14 min', level: 'Advanced' },
  { number: 16, title: 'Debugging Production', href: '/tutorials/debugging', readTime: '10 min', level: 'Advanced' },
]

const TOTAL_TIME = TUTORIALS.reduce((acc, t) => acc + parseInt(t.readTime), 0) // ~133 minutes

interface TutorialProgressProps {
  currentNumber: number
  isOpen?: boolean
  onToggle?: () => void
}

export function TutorialProgress({ currentNumber, isOpen: controlledOpen, onToggle }: TutorialProgressProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setIsOpen = onToggle ? () => onToggle() : setInternalOpen
  
  const progress = (currentNumber / TUTORIALS.length) * 100
  const completedCount = currentNumber - 1
  const remainingCount = TUTORIALS.length - currentNumber
  
  // Calculate estimated time remaining
  const remainingTime = TUTORIALS
    .slice(currentNumber)
    .reduce((acc, t) => acc + parseInt(t.readTime), 0)

  return (
    <div className="w-full">
      {/* Progress Summary Bar */}
      <div 
        className="flex items-center gap-4 p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--border-default)] transition-all"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2 gap-4">
            <span className="text-sm font-medium text-[var(--text-primary)] whitespace-nowrap">
              Getting Started Series
            </span>
            <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">
              {currentNumber} of {TUTORIALS.length} &middot; ~{TOTAL_TIME} min total
            </span>
          </div>
          
          {/* Progress bar */}
          <div className="h-2 bg-[var(--surface-overlay)] rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--brand-primary)] rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          
          <div className="flex items-center justify-between mt-2 text-xs text-[var(--text-muted)]">
            <span>{completedCount} completed</span>
            <span>{remainingCount} remaining (~{remainingTime} min)</span>
          </div>
        </div>
        
        <ChevronRight 
          size={20} 
          className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`} 
        />
      </div>

      {/* Expanded Roadmap */}
      {isOpen && (
        <div className="mt-3 p-4 rounded-xl bg-[var(--surface-raised)] border border-[var(--border-subtle)] max-h-[60vh] overflow-y-auto">
          <div className="space-y-1">
            {TUTORIALS.map((tutorial) => {
              const isCurrent = tutorial.number === currentNumber
              const isCompleted = tutorial.number < currentNumber
              
              return (
                <Link
                  key={tutorial.number}
                  to={tutorial.href}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                    isCurrent 
                      ? 'bg-[var(--interactive-active)] border border-[var(--brand-primary)]/30' 
                      : 'hover:bg-[var(--interactive-hover)]'
                  }`}
                >
                  {/* Status indicator */}
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${
                    isCompleted 
                      ? 'bg-[var(--success)] text-white' 
                      : isCurrent
                      ? 'bg-[var(--brand-primary)] text-white'
                      : 'bg-[var(--surface-overlay)] text-[var(--text-muted)]'
                  }`}>
                    {isCompleted ? <Check size={14} /> : tutorial.number}
                  </div>
                  
                  {/* Tutorial info */}
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-medium truncate ${
                      isCurrent ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                    }`}>
                      {tutorial.title}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Clock size={12} />
                      {tutorial.readTime}
                      <span className="text-[var(--border-subtle)]">•</span>
                      <span className={`
                        ${tutorial.level === 'Beginner' ? 'text-green-500' : ''}
                        ${tutorial.level === 'Intermediate' ? 'text-amber-500' : ''}
                        ${tutorial.level === 'Advanced' ? 'text-red-500' : ''}
                      `}>
                        {tutorial.level}
                      </span>
                    </div>
                  </div>
                  
                  {/* Current indicator */}
                  {isCurrent && (
                    <MapPin size={16} className="text-[var(--brand-primary)] shrink-0" />
                  )}
                </Link>
              )
            })}
          </div>
          
          {/* Completion message */}
          {currentNumber === TUTORIALS.length && (
            <div className="mt-4 p-4 rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/20 text-center">
              <Trophy size={24} className="mx-auto mb-2 text-[var(--success)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Congratulations! You've completed the series.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Hook to track tutorial progress in localStorage
export function useTutorialProgress() {
  const [completedTutorials, setCompletedTutorials] = React.useState<number[]>([])
  
  React.useEffect(() => {
    const stored = localStorage.getItem('pd-completed-tutorials')
    if (stored) {
      setCompletedTutorials(JSON.parse(stored))
    }
  }, [])
  
  const markComplete = (tutorialNumber: number) => {
    const updated = [...new Set([...completedTutorials, tutorialNumber])]
    setCompletedTutorials(updated)
    localStorage.setItem('pd-completed-tutorials', JSON.stringify(updated))
  }
  
  const isCompleted = (tutorialNumber: number) => completedTutorials.includes(tutorialNumber)
  
  return { completedTutorials, markComplete, isCompleted }
}
