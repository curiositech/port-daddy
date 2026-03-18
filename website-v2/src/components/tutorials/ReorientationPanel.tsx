import * as React from 'react'
import { Link } from 'react-router-dom'
import { X, RotateCcw, Play, Map } from 'lucide-react'

interface ReorientationPanelProps {
  tutorialNumber: number
  tutorialTitle: string
  onDismiss: () => void
}

export function ReorientationPanel({ tutorialNumber, tutorialTitle, onDismiss }: ReorientationPanelProps) {
  const [dismissed, setDismissed] = React.useState(false)
  
  if (dismissed) return null
  
  return (
    <div className="mb-8 p-4 rounded-xl bg-[var(--brand-primary)]/10 border border-[var(--brand-primary)]/30">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-[var(--brand-primary)]/20 flex items-center justify-center shrink-0">
          <RotateCcw size={20} className="text-[var(--brand-primary)]" />
        </div>
        
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-[var(--text-primary)]">
              Welcome back!
            </h3>
            <button
              onClick={() => {
                setDismissed(true)
                onDismiss()
              }}
              className="p-1 rounded hover:bg-[var(--interactive-hover)] text-[var(--text-muted)]"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
          
          <p className="text-sm text-[var(--text-secondary)] mb-3">
            You were reading <strong className="text-[var(--text-primary)]">{tutorialTitle}</strong> (Lesson {tutorialNumber} of 16)
          </p>
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                setDismissed(true)
                onDismiss()
                // Scroll to where they left off (or top if first visit)
                const savedPosition = localStorage.getItem(`pd-tutorial-${tutorialNumber}-scroll`)
                if (savedPosition) {
                  window.scrollTo({ top: parseInt(savedPosition), behavior: 'smooth' })
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--brand-primary)] text-[var(--brand-on-primary)] text-sm font-medium hover:bg-[var(--brand-primary-hover)] transition-colors"
            >
              <Play size={14} />
              Continue where I left off
            </button>
            
            <Link
              to="/tutorials"
              onClick={() => {
                setDismissed(true)
                onDismiss()
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--interactive-hover)] transition-colors"
            >
              <Map size={14} />
              Browse all tutorials
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
