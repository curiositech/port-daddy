import * as React from "react";
import { Link } from "react-router-dom";
import { Check, ChevronRight } from "lucide-react";
import { Surface } from "@/components/ui/Surface";
import { TUTORIALS as CANONICAL_TUTORIALS } from "@/data/tutorials";

interface Tutorial {
  number: number;
  title: string;
  href: string;
  readTime: string;
  level: "Beginner" | "Intermediate" | "Advanced";
}

const LEVEL_LABELS: Record<
  (typeof CANONICAL_TUTORIALS)[number]["level"],
  Tutorial["level"]
> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

const TUTORIALS: Tutorial[] = CANONICAL_TUTORIALS.map((tutorial) => ({
  number: Number.parseInt(tutorial.number, 10),
  title: tutorial.title,
  href: tutorial.href,
  readTime: tutorial.time,
  level: LEVEL_LABELS[tutorial.level],
}));

const TOTAL_TIME = TUTORIALS.reduce((acc, t) => acc + parseInt(t.readTime), 0); // ~133 minutes

interface TutorialProgressProps {
  currentNumber: number;
  isOpen?: boolean;
  onToggle?: () => void;
}

export function TutorialProgress({
  currentNumber,
  isOpen: controlledOpen,
  onToggle,
}: TutorialProgressProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = onToggle ? () => onToggle() : setInternalOpen;

  const progress = (currentNumber / TUTORIALS.length) * 100;
  const completedCount = currentNumber - 1;
  const remainingCount = TUTORIALS.length - currentNumber;

  // Calculate estimated time remaining
  const remainingTime = TUTORIALS.slice(currentNumber).reduce(
    (acc, t) => acc + parseInt(t.readTime),
    0,
  );

  return (
    <div className="w-full">
      {/* Progress Summary Bar */}
      <Surface
        depth="raised"
        radius="none"
        padding="none"
        interactive
        className="flex cursor-pointer items-center gap-[var(--space-4)] p-[var(--space-4)] sm:p-[var(--space-5)]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex-1 space-y-[var(--space-2)]">
          <div className="flex items-center justify-between gap-[var(--space-4)]">
            <span className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
              Course Progress
            </span>
            <span className="font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              {currentNumber} of {TUTORIALS.length} &middot; ~{TOTAL_TIME} min
              total
            </span>
          </div>

          {/* Progress bar — inset track */}
          <Surface
            depth="flat"
            radius="none"
            padding="none"
            className="h-[var(--space-2)] overflow-hidden"
          >
            <div
              className="h-full bg-[var(--brand-primary)] transition-all duration-500"
              style={{
                width: `${progress}%`,
              }}
            />
          </Surface>

          <div className="flex items-center justify-between font-sans text-[length:var(--type-meta-size)] text-[var(--text-muted)]">
            <span>{completedCount} completed</span>
            <span>
              {remainingCount} remaining (~{remainingTime} min)
            </span>
          </div>
        </div>

        <ChevronRight
          size={20}
          className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
      </Surface>

      {/* Expanded Roadmap */}
      {isOpen && (
        <Surface
          depth="flat"
          radius="none"
          padding="lg"
          className="mt-[var(--space-4)] max-h-[60vh] overflow-y-auto"
        >
          <div className="space-y-[var(--space-2)]">
            {TUTORIALS.map((tutorial) => {
              const isCurrent = tutorial.number === currentNumber;
              const isCompleted = tutorial.number < currentNumber;

              return (
                <Link
                  key={tutorial.number}
                  to={tutorial.href}
                  className="block"
                >
                  <Surface
                    depth={isCurrent ? "inset" : "flat"}
                    radius="none"
                    padding="none"
                    className={`flex items-center gap-[var(--space-4)] p-[var(--space-4)] transition-opacity ${
                      isCurrent ? "" : "hover:opacity-80"
                    }`}
                  >
                    {/* Status indicator */}
                    <Surface
                      depth="flat"
                      radius="none"
                      padding="none"
                      className="flex h-8 w-8 shrink-0 items-center justify-center text-xs font-bold"
                      style={
                        isCompleted
                          ? {
                              background: "var(--status-success)",
                              color: "var(--text-inverse)",
                            }
                          : isCurrent
                            ? {
                                background: "var(--brand-primary)",
                                color: "var(--text-inverse)",
                              }
                            : {}
                      }
                    >
                      {isCompleted ? <Check size={14} /> : tutorial.number}
                    </Surface>

                    {/* Tutorial info */}
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate text-[length:var(--type-small-size)] font-semibold"
                        style={{
                          color: isCurrent
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        }}
                      >
                        {tutorial.title}
                      </div>
                      <div
                        className="flex items-center gap-[var(--space-2)] text-[length:var(--type-meta-size)]"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {tutorial.readTime}
                        <span style={{ color: "var(--border-default)" }}>
                          &middot;
                        </span>
                        <span
                          style={{
                            color:
                              tutorial.level === "Beginner"
                                ? "var(--status-success)"
                                : tutorial.level === "Intermediate"
                                  ? "var(--status-warning)"
                                  : "var(--brand-primary)",
                          }}
                        >
                          {tutorial.level}
                        </span>
                      </div>
                    </div>

                    {isCurrent && (
                      <span className="shrink-0 font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                        Current
                      </span>
                    )}
                  </Surface>
                </Link>
              );
            })}
          </div>

          {currentNumber === TUTORIALS.length && (
            <Surface
              depth="raised"
              radius="none"
              padding="lg"
              className="mt-[var(--space-4)] text-center"
            >
              <p className="font-display text-[length:var(--type-panel-title-card-size)] font-black text-[var(--text-primary)]">
                Congratulations! You've completed the series.
              </p>
            </Surface>
          )}
        </Surface>
      )}
    </div>
  );
}
