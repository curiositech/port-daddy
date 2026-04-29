import * as React from "react";
import { Link } from "react-router-dom";
import { X, RotateCcw, Play, Map } from "lucide-react";

interface ReorientationPanelProps {
  tutorialNumber: number;
  tutorialTitle: string;
  onDismiss: () => void;
}

export function ReorientationPanel({
  tutorialNumber,
  tutorialTitle,
  onDismiss,
}: ReorientationPanelProps) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  return (
    <div className="mb-[var(--space-6)] border-2 border-[var(--brand-primary)] bg-[color:var(--surface-raised)] p-[var(--space-4)]">
      <div className="flex items-start gap-[var(--space-4)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] bg-[var(--surface-base)]">
          <RotateCcw size={20} className="text-[var(--brand-primary)]" />
        </div>

        <div className="flex-1">
          <div className="mb-[var(--space-1)] flex items-center justify-between">
            <h3 className="font-semibold text-[var(--text-primary)]">
              Welcome back!
            </h3>
            <button
              onClick={() => {
                setDismissed(true);
                onDismiss();
              }}
              className="border border-transparent p-[var(--space-1)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:bg-[var(--interactive-hover)]"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>

          <p className="mb-[var(--space-3)] text-sm text-[var(--text-secondary)]">
            You were reading{" "}
            <strong className="text-[var(--text-primary)]">
              {tutorialTitle}
            </strong>{" "}
            (Lesson {tutorialNumber} of 16)
          </p>

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <button
              onClick={() => {
                setDismissed(true);
                onDismiss();
                // Scroll to where they left off (or top if first visit)
                const savedPosition = localStorage.getItem(
                  `pd-tutorial-${tutorialNumber}-scroll`,
                );
                if (savedPosition) {
                  window.scrollTo({
                    top: parseInt(savedPosition),
                    behavior: "smooth",
                  });
                }
              }}
              className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--brand-primary)] px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium text-[var(--brand-primary-foreground)] transition-colors hover:bg-[var(--brand-primary)]"
            >
              <Play size={14} />
              Continue where I left off
            </button>

            <Link
              to="/tutorials"
              onClick={() => {
                setDismissed(true);
                onDismiss();
              }}
              className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <Map size={14} />
              Browse all tutorials
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
