import * as React from 'react'
import { Link } from 'react-router-dom'
import { Map, Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PanelBody, PanelEyebrow, PanelTitle, SurfacePanel } from '@/components/site/primitives'

interface ReorientationPanelProps {
  tutorialNumber: number
  tutorialTitle: string
  onDismiss: () => void
}

export function ReorientationPanel({
  tutorialNumber,
  tutorialTitle,
  onDismiss,
}: ReorientationPanelProps) {
  const [dismissed, setDismissed] = React.useState(false)

  if (dismissed) return null

  return (
    <SurfacePanel padding="compact" className="mb-[var(--space-4)] max-w-[52rem] space-y-[var(--space-3)]">
      <div className="flex items-start justify-between gap-[var(--space-3)]">
        <div className="flex items-start gap-[var(--space-3)]">
          <div className="flex h-9 w-9 items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] text-[var(--brand-primary)]">
            <RotateCcw size={16} />
          </div>
          <div className="space-y-[var(--space-1)]">
            <PanelEyebrow>Welcome back</PanelEyebrow>
            <PanelTitle as="h3" size="nav" className="max-w-none">
              Resume lesson {tutorialNumber}
            </PanelTitle>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setDismissed(true)
            onDismiss()
          }}
          aria-label="Dismiss"
        >
          <X size={16} />
        </Button>
      </div>

      <PanelBody size="compact" className="max-w-[40rem]">
        You were reading <strong>{tutorialTitle}</strong> and can continue from your saved position
        or jump back to the tutorial index.
      </PanelBody>

      <div className="flex flex-wrap items-center gap-[var(--space-3)]">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setDismissed(true)
            onDismiss()
            const savedPosition = localStorage.getItem(`pd-tutorial-${tutorialNumber}-scroll`)
            if (savedPosition) {
              window.scrollTo({ top: Number.parseInt(savedPosition, 10), behavior: 'smooth' })
            }
          }}
        >
          <Play size={14} />
          Continue
        </Button>

        <Button asChild variant="ghost" size="sm">
          <Link
            to="/tutorials"
            onClick={() => {
              setDismissed(true)
              onDismiss()
            }}
          >
            <Map size={14} />
            Browse lessons
          </Link>
        </Button>
      </div>
    </SurfacePanel>
  )
}
