import * as React from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronRight, Clock, MapPin, Trophy } from 'lucide-react'
import { BracketLabel, PanelBody, PanelEyebrow, PanelTitle, SurfacePanel } from '@/components/site/primitives'
import { cn } from '@/lib/utils'

interface Tutorial {
  number: number
  title: string
  href: string
  readTime: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
}

const TUTORIALS: Tutorial[] = [
  { number: 1, title: 'Getting Started', href: '/tutorials/getting-started', readTime: '5 min', level: 'Beginner' },
  { number: 2, title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent', readTime: '12 min', level: 'Intermediate' },
  { number: 3, title: 'Monorepo Mastery', href: '/tutorials/monorepo', readTime: '10 min', level: 'Intermediate' },
  { number: 4, title: 'Debugging with Port Daddy', href: '/tutorials/debugging', readTime: '8 min', level: 'Intermediate' },
  { number: 5, title: 'Tunnels', href: '/tutorials/tunnel', readTime: '6 min', level: 'Beginner' },
  { number: 6, title: 'DNS Resolver', href: '/tutorials/dns', readTime: '8 min', level: 'Intermediate' },
  { number: 7, title: 'Session Phases', href: '/tutorials/session-phases', readTime: '15 min', level: 'Advanced' },
  { number: 8, title: 'Inbox & Messaging', href: '/tutorials/inbox', readTime: '10 min', level: 'Advanced' },
  { number: 9, title: 'Sugar Commands', href: '/tutorials/sugar', readTime: '5 min', level: 'Beginner' },
  { number: 10, title: 'Spawn + Watch Pattern', href: '/tutorials/always-on', readTime: '15 min', level: 'Advanced' },
  { number: 11, title: 'pd spawn: One-Shot Agents', href: '/tutorials/pd-spawn', readTime: '10 min', level: 'Intermediate' },
  { number: 12, title: 'Harbor Tokens (Advisory)', href: '/tutorials/harbors', readTime: '12 min', level: 'Advanced' },
  { number: 13, title: 'Control Plane + FleetBar', href: '/tutorials/dashboard', readTime: '7 min', level: 'Beginner' },
  { number: 14, title: 'Activity Log Inspection', href: '/tutorials/time-travel', readTime: '8 min', level: 'Intermediate' },
  { number: 15, title: 'Reactive Pipelines', href: '/tutorials/pipelines', readTime: '12 min', level: 'Advanced' },
  { number: 16, title: 'Swarm Observation', href: '/tutorials/watch', readTime: '10 min', level: 'Intermediate' },
  { number: 17, title: 'Multiplayer Localhost', href: '/tutorials/remote-harbors', readTime: '15 min', level: 'Advanced' },
  { number: 18, title: 'Fleet: Background Agents', href: '/tutorials/fleet', readTime: '12 min', level: 'Intermediate' },
  { number: 19, title: 'Pheromone Trails', href: '/tutorials/pheromone', readTime: '8 min', level: 'Intermediate' },
]

const TOTAL_TIME = TUTORIALS.reduce((acc, tutorial) => acc + Number.parseInt(tutorial.readTime, 10), 0)

interface TutorialProgressProps {
  currentNumber: number
  isOpen?: boolean
  onToggle?: () => void
}

function levelTone(level: Tutorial['level']) {
  if (level === 'Beginner') return 'default'
  if (level === 'Intermediate') return 'accent'
  return 'primary'
}

export function TutorialProgress({ currentNumber, isOpen: controlledOpen, onToggle }: TutorialProgressProps) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isOpen = controlledOpen ?? internalOpen
  const setOpen = onToggle ? onToggle : () => setInternalOpen((open) => !open)

  const progress = (currentNumber / TUTORIALS.length) * 100
  const completedCount = currentNumber - 1
  const remainingCount = TUTORIALS.length - currentNumber
  const remainingTime = TUTORIALS.slice(currentNumber).reduce(
    (acc, tutorial) => acc + Number.parseInt(tutorial.readTime, 10),
    0,
  )

  return (
    <div className="w-full space-y-[var(--space-3)]">
      <SurfacePanel elevation="quiet" padding="compact" className="space-y-[var(--space-3)]">
        <button
          type="button"
          onClick={setOpen}
          className="w-full cursor-pointer space-y-[var(--space-3)] text-left"
          aria-expanded={isOpen}
          aria-controls="tutorial-progress-roadmap"
        >
          <div className="flex items-start justify-between gap-[var(--space-3)]">
            <div className="space-y-[var(--space-1)]">
              <BracketLabel>Series progress</BracketLabel>
              <PanelTitle as="p" size="nav" className="max-w-none">
                Getting Started Series
              </PanelTitle>
            </div>

            <div className="flex items-center gap-[var(--space-3)]">
              <PanelEyebrow>
                {currentNumber} of {TUTORIALS.length} / {TOTAL_TIME} min
              </PanelEyebrow>
              <ChevronRight
                size={18}
                className={cn('text-[var(--text-muted)] transition-transform', isOpen ? 'rotate-90' : '')}
              />
            </div>
          </div>

          <div className="space-y-[var(--space-2)]">
            <div className="h-[10px] border-2 border-[var(--border-strong)] bg-[var(--surface-sunken)]">
              <div className="h-full bg-[var(--brand-primary)] transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>

            <div className="flex items-center justify-between gap-[var(--space-3)]">
              <PanelEyebrow>{completedCount} completed</PanelEyebrow>
              <PanelEyebrow>
                {remainingCount} remaining / {remainingTime} min
              </PanelEyebrow>
            </div>
          </div>
        </button>
      </SurfacePanel>

      {isOpen ? (
        <SurfacePanel elevation="quiet" padding="compact" className="space-y-0" >
          <div id="tutorial-progress-roadmap" className="space-y-0">
            {TUTORIALS.map((tutorial) => {
              const isCurrent = tutorial.number === currentNumber
              const isCompleted = tutorial.number < currentNumber
              const tone = levelTone(tutorial.level)

              return (
                <Link
                  key={tutorial.number}
                  to={tutorial.href}
                  className={cn(
                    'block border-t border-[var(--border-default)] px-[var(--space-3)] py-[var(--space-3)] no-underline first:border-t-0',
                    isCurrent ? 'bg-[var(--surface-raised)]' : 'hover:bg-[var(--interactive-hover)]',
                  )}
                >
                  <div className="grid gap-[var(--space-2)] md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start">
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center border-2 font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
                        isCompleted
                          ? 'border-[var(--border-strong)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
                          : isCurrent
                            ? 'border-[var(--border-strong)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
                            : 'border-[var(--border-default)] bg-[var(--surface-base)] text-[var(--text-secondary)]',
                      )}
                    >
                      {isCompleted ? <Check size={14} /> : tutorial.number}
                    </div>

                    <div className="space-y-[var(--space-1)]">
                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <PanelTitle as="p" size="nav" className="max-w-none">
                          {tutorial.title}
                        </PanelTitle>
                        {isCurrent ? <BracketLabel tone="accent">Current</BracketLabel> : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-[var(--space-2)]">
                        <PanelEyebrow tone={tone}>{tutorial.level}</PanelEyebrow>
                        <div className="h-[var(--space-3)] w-px bg-[var(--border-default)]" />
                        <PanelEyebrow>
                          <Clock size={12} className="mr-[var(--space-1)] inline-block" />
                          {tutorial.readTime}
                        </PanelEyebrow>
                      </div>
                    </div>

                    {isCurrent ? (
                      <MapPin size={16} className="mt-[3px] text-[var(--brand-primary)]" />
                    ) : null}
                  </div>
                </Link>
              )
            })}
          </div>

          {currentNumber === TUTORIALS.length ? (
            <div className="border-t-2 border-[var(--border-default)] pt-[var(--space-4)] text-center">
              <div className="mb-[var(--space-2)] flex justify-center">
                <Trophy size={20} className="text-[var(--status-success)]" />
              </div>
              <PanelTitle as="p" size="nav" className="max-w-none">
                Series complete
              </PanelTitle>
              <PanelBody size="compact" className="mx-auto mt-[var(--space-2)] max-w-[30rem]">
                You finished the lesson sequence and can move into the broader docs and operator surfaces.
              </PanelBody>
            </div>
          ) : null}
        </SurfacePanel>
      ) : null}
    </div>
  )
}

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
