import * as React from "react";
import { Link } from "react-router-dom";
import { Surface } from "@/components/ui/Surface";
import { TUTORIALS as CANONICAL_TUTORIALS } from "@/data/tutorials";

interface Tutorial {
  number: number;
  title: string;
  href: string;
  readTime: string;
}

const TUTORIALS: Tutorial[] = CANONICAL_TUTORIALS.map((tutorial) => ({
  number: Number.parseInt(tutorial.number, 10),
  title: tutorial.title,
  href: tutorial.href,
  readTime: tutorial.time,
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

  const progressSummary = `Lesson ${currentNumber}/${TUTORIALS.length} - ${TOTAL_TIME} min total`;

  return (
    <div className="w-full">
      {/* Progress Summary Bar */}
      <Surface
        depth="raised"
        radius="none"
        padding="none"
        interactive
        className="flex cursor-pointer flex-col items-stretch gap-[var(--space-4)] p-[var(--space-4)] sm:flex-row sm:items-center sm:p-[var(--space-5)]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="w-full min-w-0 flex-1 space-y-[var(--space-2)]">
          <div className="flex flex-col items-start gap-[var(--space-1)] sm:flex-row sm:items-center sm:justify-between sm:gap-[var(--space-4)]">
            <span className="font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
              Course Progress
            </span>
            <span className="font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] sm:text-right">
              {progressSummary}
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

          <div className="flex flex-col gap-px font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
            <span>{completedCount} completed</span>
            <span>
              {remainingCount} remaining (~{remainingTime} min)
            </span>
          </div>
        </div>

        <span className="self-start font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)] sm:self-center">
          {isOpen ? "Hide map" : "Open map"}
        </span>
      </Surface>

      {/* Expanded Roadmap */}
      {isOpen && (
        <Surface
          depth="flat"
          radius="none"
          padding="lg"
          className="mt-[var(--space-4)] max-h-[60vh] overflow-y-auto"
        >
          <div className="space-y-px">
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
                    className={`grid min-h-[4.5rem] grid-cols-[auto,minmax(0,1fr)] items-center gap-x-[var(--space-4)] gap-y-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)] transition-opacity sm:grid-cols-[auto,minmax(0,1fr),auto] sm:px-[var(--space-4)] ${
                      isCurrent ? "" : "hover:opacity-80"
                    }`}
                  >
                    <div className="flex min-w-[2.5rem] items-center">
                      <Surface
                        depth="flat"
                        radius="none"
                        padding="none"
                        className="flex h-8 min-w-8 items-center justify-center px-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)]"
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
                              : {
                                  background: "var(--surface-base)",
                                  color: "var(--text-primary)",
                                }
                        }
                      >
                        {isCompleted ? "Done" : `#${tutorial.number}`}
                      </Surface>
                    </div>

                    <div className="min-w-0">
                      <div
                        className="text-balance font-display text-[length:var(--type-panel-body-size)] font-black leading-[1.08]"
                        style={{
                          color: isCurrent
                            ? "var(--text-primary)"
                            : "var(--text-secondary)",
                        }}
                      >
                        {tutorial.title}
                      </div>
                    </div>

                    <div className="col-start-2 flex flex-wrap items-center gap-x-[var(--space-4)] gap-y-px justify-self-start sm:col-start-auto sm:flex-nowrap sm:justify-self-end">
                      <span className="shrink-0 font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
                        {tutorial.readTime}
                      </span>
                      {isCurrent ? (
                        <span className="shrink-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                          Current lesson
                        </span>
                      ) : isCompleted ? (
                        <span className="shrink-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--status-success)]">
                          Complete
                        </span>
                      ) : null}
                    </div>
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
