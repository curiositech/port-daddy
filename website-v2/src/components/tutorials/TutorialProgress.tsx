import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check, Clock, MapPin, ChevronRight, Trophy } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

interface Tutorial {
  number: number
  title: string
  href: string
  readTime: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
}

// Tutorial roadmap data — must stay in sync with src/data/tutorials.ts
const TUTORIALS: Tutorial[] = [
  { number: 1, title: 'Getting Started', href: '/tutorials/getting-started', readTime: '5 min', level: 'Beginner' },
  { number: 2, title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent', readTime: '12 min', level: 'Intermediate' },
  { number: 3, title: 'Monorepo Mastery', href: '/tutorials/monorepo', readTime: '10 min', level: 'Intermediate' },
  { number: 4, title: 'Debugging', href: '/tutorials/debugging', readTime: '8 min', level: 'Intermediate' },
  { number: 5, title: 'Tunnels', href: '/tutorials/tunnel', readTime: '6 min', level: 'Beginner' },
  { number: 6, title: 'DNS Resolver', href: '/tutorials/dns', readTime: '8 min', level: 'Intermediate' },
  { number: 7, title: 'Session Phases', href: '/tutorials/session-phases', readTime: '15 min', level: 'Advanced' },
  { number: 8, title: 'Inbox & Messaging', href: '/tutorials/inbox', readTime: '10 min', level: 'Advanced' },
  { number: 9, title: 'Sugar Commands', href: '/tutorials/sugar', readTime: '5 min', level: 'Beginner' },
  { number: 10, title: 'Spawn + Watch Pattern', href: '/tutorials/always-on', readTime: '15 min', level: 'Advanced' },
  { number: 11, title: 'pd spawn: Agent Fleets', href: '/tutorials/pd-spawn', readTime: '15 min', level: 'Advanced' },
  { number: 12, title: 'Harbor Tokens', href: '/tutorials/harbors', readTime: '12 min', level: 'Advanced' },
  { number: 13, title: 'Live Dashboard', href: '/tutorials/dashboard', readTime: '5 min', level: 'Beginner' },
  { number: 14, title: 'Activity Log', href: '/tutorials/time-travel', readTime: '8 min', level: 'Intermediate' },
  { number: 15, title: 'Reactive Pipelines', href: '/tutorials/pipelines', readTime: '12 min', level: 'Advanced' },
  { number: 16, title: 'Swarm Observation', href: '/tutorials/watch', readTime: '10 min', level: 'Intermediate' },
  { number: 17, title: 'Multiplayer Localhost', href: '/tutorials/remote-harbors', readTime: '15 min', level: 'Advanced' },
  { number: 18, title: 'Fleet: Background Agents', href: '/tutorials/fleet', readTime: '12 min', level: 'Intermediate' },
  { number: 19, title: 'Pheromone Trails', href: '/tutorials/pheromone', readTime: '8 min', level: 'Intermediate' },
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
      <Surface
        depth="raised"
        radius="2xl"
        padding="lg"
        interactive
        className="flex items-center gap-6 cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Getting Started Series
            </span>
            <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {currentNumber} of {TUTORIALS.length} &middot; ~{TOTAL_TIME} min total
            </span>
          </div>

          {/* Progress bar — inset track */}
          <Surface depth="inset" radius="full" padding="none" className="h-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: 'var(--brand-primary)' }}
            />
          </Surface>

          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{completedCount} completed</span>
            <span>{remainingCount} remaining (~{remainingTime} min)</span>
          </div>
        </div>

        <ChevronRight
          size={20}
          className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
          style={{ color: 'var(--text-muted)' }}
        />
      </Surface>

      {/* Expanded Roadmap */}
      {isOpen && (
        <Surface depth="inset" radius="2xl" padding="lg" className="mt-4 max-h-[60vh] overflow-y-auto">
          <div className="space-y-2">
            {TUTORIALS.map((tutorial) => {
              const isCurrent = tutorial.number === currentNumber
              const isCompleted = tutorial.number < currentNumber

              return (
                <Link
                  key={tutorial.number}
                  to={tutorial.href}
                  className="block"
                >
                  <Surface
                    depth={isCurrent ? 'inset' : 'flat'}
                    radius="xl"
                    padding="none"
                    className={`flex items-center gap-4 p-4 transition-all ${
                      isCurrent ? '' : 'hover:opacity-80'
                    }`}
                  >
                    {/* Status indicator */}
                    <Surface
                      depth="inset"
                      radius="full"
                      padding="none"
                      className="w-8 h-8 flex items-center justify-center text-xs font-bold shrink-0"
                      style={
                        isCompleted
                          ? { background: 'var(--status-success)', color: 'var(--text-inverse)' }
                          : isCurrent
                          ? { background: 'var(--brand-primary)', color: 'var(--text-inverse)' }
                          : {}
                      }
                    >
                      {isCompleted ? <Check size={14} /> : tutorial.number}
                    </Surface>

                    {/* Tutorial info */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-sm font-semibold truncate"
                        style={{ color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {tutorial.title}
                      </div>
                      <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <Clock size={12} />
                        {tutorial.readTime}
                        <span style={{ color: 'var(--border-default)' }}>&middot;</span>
                        <span style={{
                          color: tutorial.level === 'Beginner' ? 'var(--status-success)'
                            : tutorial.level === 'Intermediate' ? 'var(--status-warning)'
                            : 'var(--brand-primary)'
                        }}>
                          {tutorial.level}
                        </span>
                      </div>
                    </div>

                    {isCurrent && (
                      <MapPin size={16} style={{ color: 'var(--brand-primary)' }} className="shrink-0" />
                    )}
                  </Surface>
                </Link>
              )
            })}
          </div>

          {currentNumber === TUTORIALS.length && (
            <Surface depth="raised" radius="xl" padding="lg" className="mt-4 text-center">
              <Trophy size={24} className="mx-auto mb-2" style={{ color: 'var(--status-success)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Congratulations! You've completed the series.
              </p>
            </Surface>
          )}
        </Surface>
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
