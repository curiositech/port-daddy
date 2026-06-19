import * as React from "react";
import { Link } from "react-router-dom";
import { X, RotateCcw, Play, Map } from "lucide-react";
import { Button } from "@/components/ui/Button";

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

  const handleResume = () => {
    setDismissed(true);
    onDismiss();
    const savedPosition = localStorage.getItem(
      `pd-tutorial-${tutorialNumber}-scroll`,
    );
    if (savedPosition) {
      window.scrollTo({
        top: parseInt(savedPosition),
        behavior: "smooth",
      });
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  return (
    <div className="mb-[var(--space-6)] border-2 border-[var(--brand-primary)] bg-[color:var(--surface-raised)] p-[var(--space-4)]">
      <div className="flex items-start gap-[var(--space-4)]">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-[var(--brand-primary)] bg-[var(--surface-base)]">
          <RotateCcw size={20} className="text-[var(--brand-primary)]" />
        </div>

        <div className="flex-1">
          <div className="mb-[var(--space-1)] flex items-center justify-between">
            <h3 className="font-display text-[length:var(--type-panel-title-nav-size)] font-black text-[var(--text-primary)]">
              Welcome back.
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              aria-label="Dismiss"
            >
              <X size={16} />
            </Button>
          </div>

          <p className="mb-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
            You were reading{" "}
            <strong className="text-[var(--text-primary)]">
              {tutorialTitle}
            </strong>{" "}
            (Lesson {tutorialNumber} of 21) — picking up where the page last left you.
          </p>

          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleResume}
              className="inline-flex items-center gap-[var(--space-2)]"
            >
              <Play size={14} />
              Pick it up
            </Button>

            <Link
              to="/tutorials"
              onClick={handleDismiss}
              className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--interactive-hover)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
            >
              <Map size={14} />
              Browse the whole syllabus
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
