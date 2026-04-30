import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { ConsoleScreenshotFigure } from "@/components/tutorials/ConsoleScreenshotFigure";
import { CodeBlock } from "@/components/ui/CodeBlock";

export function Spawn() {
  return (
    <TutorialLayout
      title="Budgeted One-Shot Agents"
      description="Use pd spawn when you want direct daemon-backed execution inside a harbor with explicit identity, cost ceiling, telemetry, and salvage."
      number={13}
      total={21}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Spawn + Watch Pattern", href: "/tutorials/always-on" }}
      next={{ title: "Activity Log Inspection", href: "/tutorials/time-travel" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The human reviews the run in Sorties and Activity</h2>
          <p>
            A one-shot launch is still part of the shared system. The daemon may
            start it from the CLI, but the person supervising the work checks
            the result in the Fleet Control Center&apos;s{" "}
            <strong>Sorties</strong>, <strong>Activity</strong>, and{" "}
            <strong>Flow</strong> surfaces, not by trusting a disappearing shell
            transcript.
          </p>
          <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
            <ConsoleScreenshotFigure
              lightSrc="/img/app-screens/sorties-light.png"
              darkSrc="/img/app-screens/sorties-dark.png"
              alt="Fleet Control Center Sorties surface"
              caption="Human control layer: Sorties is the place to inspect the launch record, backend, tier, status, and result trail after a bounded run exits."
            />
            <ConsoleScreenshotFigure
              lightSrc="/media/landing-live-glory/live-flow-light.png"
              darkSrc="/media/landing-live-glory/live-flow-dark.png"
              alt="Fleet Control Center Flow surface"
              caption="Human control layer: Flow confirms that the launch belongs to the right project and that the surrounding agent activity stayed attached to the same runtime story."
            />
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Launch with identity, backend, and budget</h2>
          <p>
            Port Daddy refuses anonymous or unbudgeted one-shot runs. Give the
            daemon enough information to attribute the work, preflight the
            backend, and enforce the ceiling before the model starts spending.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd spawn --backend codex \\
    --tier low \\
    --identity port-daddy:docs:spawn-sync \\
    --budget 0.75 \\
    -- "Rewrite the website spawn docs so they match the daemon contract"
spawned agent-f0d91f2e on codex:gpt-5.4-mini
session: session-port-daddy-docs-spawn-sync-2b7ef0b3
budget ceiling: $0.75
status: running`}
          </CodeBlock>
          <p>
            That is the minimum honest launch surface: backend, model tier,
            identity, session id, and the budget ceiling the daemon will honor.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Check what actually happened</h2>
          <p>
            The run is not done when the process exits. Confirm the recent
            result, then read the daemon summary and notes so the next person
            can see the cost, status, and concrete outcome without rerunning the
            job.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd spawned
AGENT ID            BACKEND   MODEL            STATUS      AGE   COST
────────────────────────────────────────────────────────────────────────
agent-f0d91f2e      codex     gpt-5.4-mini     completed   14s   $0.11

$ pd briefing
Recent spawn: port-daddy:docs:spawn-sync updated spawn documentation and left a validation note.

$ pd notes --limit 5
[note] agent-f0d91f2e: Updated website spawn copy to match daemon preflight and telemetry rules.`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Use focused file scopes when the run should stay bounded</h2>
          <p>
            Aider- or Codex-backed launches should start from the smallest
            working set that still matches the job. That keeps the run cheaper,
            makes the notes clearer, and gives the person reading{" "}
            <strong>Sorties</strong> or <strong>Activity</strong> a tighter
            story about what changed.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd spawn --backend aider \\
    --identity port-daddy:ui:fleetbar \\
    --budget 1.25 \\
    --files apps/FleetBar/FleetBar/CostStore.swift \\
    --files apps/FleetBar/FleetBar/CostDashboard.swift \\
    -- "Use real fleet ceilings instead of a fake visual budget reference"
spawned agent-91c3de78 on aider:gpt-4.1
files attached: 2
status: running`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  );
}
