import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function AlwaysOn() {
  return (
    <TutorialLayout
      title="Run Event-Triggered Agents"
      description="Combine pd spawn and pd watch so agents react to channel events automatically across Ollama, Codex, Claude, Gemini, Aider, and custom backends."
      number={12}
      total={22}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Sugar Commands", href: "/tutorials/sugar" }}
      next={{
        title: "pd spawn: Launch Agent Fleets",
        href: "/tutorials/pd-spawn",
      }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The shipped pattern is watch plus spawn</h2>
          <p>
            Port Daddy does support recurring automation, but the durable shape
            is not an immortal in-memory avatar. Today the common pattern
            is simpler: a watcher stays connected to a project-scoped channel,
            and each event launches a bounded agent job with{" "}
            <code>pd spawn</code>.
          </p>
          <div className="border-y border-[var(--hairline)] py-[var(--space-4)]">
            <div className="flex flex-col gap-[var(--space-3)] md:flex-row md:items-start md:gap-[var(--space-6)]">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-black uppercase tracking-[0.18em] text-[length:var(--type-meta-size)] text-[var(--text-primary)]">
                  <code>pd watch</code>
                </p>
                <p className="mt-[var(--space-2)] max-w-[18ch] text-[length:var(--type-panel-body-compact-size)] leading-[1.45] text-[var(--text-secondary)]">
                  Listens for the project-scoped event.
                </p>
              </div>
              <div className="text-[length:var(--type-meta-size)] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                then
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 font-black uppercase tracking-[0.18em] text-[length:var(--type-meta-size)] text-[var(--text-primary)]">
                  <code>pd spawn</code>
                </p>
                <p className="mt-[var(--space-2)] max-w-[20ch] text-[length:var(--type-panel-body-compact-size)] leading-[1.45] text-[var(--text-secondary)]">
                  Launches one bounded agent run for that event.
                </p>
              </div>
              <div className="text-[length:var(--type-meta-size)] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">
                or
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 font-black uppercase tracking-[0.18em] text-[length:var(--type-meta-size)] text-[var(--text-primary)]">
                  <code>pd fleet up</code>
                </p>
                <p className="mt-[var(--space-2)] max-w-[22ch] text-[length:var(--type-panel-body-compact-size)] leading-[1.45] text-[var(--text-secondary)]">
                  Move the pattern into YAML when it should be daemon-visible and durable.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Launch a bounded agent from an event</h2>
          <p>
            Keep the long-running piece narrow. Let the watcher notice the
            event, then let the spawned job do the expensive reasoning.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd watch git:committed --exec ./scripts/review-last-commit.sh
[watch] subscribed to project:port-daddy:git:committed
[watch] waiting for next event...`}
          </CodeBlock>
          <CodeBlock copyable={false} language="bash">
            {`#!/usr/bin/env bash
set -euo pipefail

pd spawn --backend codex --tier low --budget 0.20 \\
  --identity my-app:fleet:reviewer \\
  -- "Review the most recent commit and leave a note about regressions."

# Expected daemon-visible result:
# spawned agent-7f41c2b9 on codex:gpt-5.4-mini
# session: session-my-app-fleet-reviewer-13e5f8ab
# cost ceiling: $0.20`}
          </CodeBlock>
          <p>
            That keeps every launch inspectable. The event is visible, the
            spawned run has its own status and cost record, and failures are not
            trapped in an invisible background shell.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Pick the right lifetime</h2>
          <p>
            If the automation is supposed to survive shell exits, dedupe bursts,
            honor daily budgets, and stay visible to the whole team, move it
            into the fleet layer instead of leaving it as a personal terminal
            watcher.
          </p>
          <Surface depth="flat" radius="none" padding="lg">
            <div className="space-y-[var(--space-4)]">
              <p className="m-0">
                Use a shell watcher for local experiments and one-off
                automations.
              </p>
              <p className="m-0">
                Use <code>pd spawn</code> when you want exact backend, model,
                identity, and budget control for one run.
              </p>
              <p className="m-0">
                Use <code>pd fleet up</code> when the automation is part of the
                project itself and other operators need to inspect it.
              </p>
            </div>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Persist the result, not hidden process state</h2>
          <p>
            Recurring agent workflows should put their durable state in notes,
            files, tuples, channels, or project records that Port Daddy can
            surface later. That is what makes salvage, activity review, and
            fleet inspection work.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd spawned
agent-7f41c2b9  codex:gpt-5.4-mini  completed  cost=$0.07

$ pd briefing
Recent spawn: my-app:fleet:reviewer reviewed the latest commit and filed one regression note.

$ pd notes --limit 10
[note] agent-7f41c2b9: Flagged a missing auth redirect test in src/login.test.ts`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  );
}
