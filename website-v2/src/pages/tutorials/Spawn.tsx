import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";
import { Rocket, Shield, Wallet, Compass } from "lucide-react";

export function Spawn() {
  return (
    <TutorialLayout
      title="Budgeted One-Shot Agents"
      description="Use pd spawn when you want direct daemon-backed execution inside a harbor with explicit identity, cost ceiling, telemetry, and salvage."
      number={13}
      total={22}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Spawn + Watch Pattern", href: "/tutorials/always-on" }}
      next={{ title: "Activity Log Inspection", href: "/tutorials/time-travel" }}
    >
      <div className="space-y-12">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Rocket className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">When to Use pd spawn</h2>
          </div>
          <p>
            <code>pd spawn</code> is the direct launch surface for a single
            one-shot agent. Use it when you already know the backend you want
            and you want the daemon to run the job with the normal Port Daddy
            coordination plumbing around it.
          </p>
          <Surface
            depth="flat"
            radius="none"
            padding="md"
            className="border-l-4 border-[var(--brand-primary)]"
          >
            <p
              className="m-0 text-[length:var(--type-panel-body-compact-size)]"
              style={{ color: "var(--text-secondary)" }}
            >
              Reach for <strong>pd spawn</strong> when you want a bounded
              delegated task. Reach for <strong>fleet</strong> when the work should
              stay resident and trigger over time.
            </p>
          </Surface>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Shield className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Identity and Budget Are Required</h2>
          </div>

          <p>
            Port Daddy now refuses unbudgeted or unattributed launches. Every
            one-shot run needs a semantic identity so spend lands on a project
            and a positive ceiling so the launch can be preflighted against
            current usage.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd spawn --backend codex \\
    --tier low \\
    --identity port-daddy:docs:spawn-sync \\
    --budget 0.75 \\
    -- "Rewrite the website spawn docs so they match the daemon contract"
SUCCESS: spawn accepted agent spawned-8a2f0c1c with ceiling $0.75`}
          </CodeBlock>

          <Surface depth="raised" radius="none" padding="md">
            <div className="flex items-start gap-3">
              <Wallet size={16} className="mt-0.5 text-[var(--brand-accent)]" />
              <p
                className="m-0 text-[length:var(--type-panel-body-compact-size)]"
                style={{ color: "var(--text-secondary)" }}
              >
                The ceiling is not decorative. Launch preflight checks readiness
                and current project spend before the daemon accepts the run.
              </p>
            </div>
          </Surface>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Compass className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Inspect the Run</h2>
          </div>

          <p>
            <code>pd spawn</code> returns the actual run result, and{" "}
            <code>pd spawned</code> lets you inspect what is still active or
            recently finished.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd spawned
AGENT ID            BACKEND   MODEL                    STATUS      AGE
────────────────────────────────────────────────────────────────────────
spawned-8a2f0c1c    codex      gpt-5.4-mini           completed   12s`}
          </CodeBlock>

          <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
            For an aider-backed launch, pass focused files so the spawned worker
            starts with a bounded working set instead of wandering the repo.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd spawn --backend aider \\
    --identity port-daddy:ui:fleetbar \\
    --budget 1.25 \\
    --files apps/FleetBar/FleetBar/CostStore.swift \\
    --files apps/FleetBar/FleetBar/CostDashboard.swift \\
    -- "Use real fleet ceilings instead of a fake visual budget reference"
SUCCESS: spawn accepted with 2 claimed files and telemetry enforcement enabled`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  );
}
