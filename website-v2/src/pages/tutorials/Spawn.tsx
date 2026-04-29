import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'

export function Spawn() {
  return (
    <TutorialLayout
      title="Budgeted One-Shot Agents"
      description="Use pd spawn when you want direct daemon-backed execution with explicit identity, explicit cost ceiling, and no long-lived fleet wiring."
      number={11}
      total={19}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Spawn + Watch Pattern', href: '/tutorials/always-on' }}
      next={{ title: 'Harbor Tokens (Advisory)', href: '/tutorials/harbors' }}
    >
      <div className="space-y-[var(--space-7)]">
        <section>
          <h2>When to use pd spawn</h2>
          <p>
            <code>pd spawn</code> is still the direct launch command. It is the low-level primitive for a single daemon-backed run: choose a backend, set an identity, set a positive budget ceiling, and pass one task after <code>--</code>.
          </p>
          <p>
            Use <code>pd agent</code> for the higher-level ad hoc wrapper. Use <code>pd fleet</code> when work should stay resident, react to triggers, and respawn over time.
          </p>
        </section>

        <section>
          <h2>1. Launch with identity and budget</h2>
          <p>
            Port Daddy now refuses unbudgeted or unattributed launches. Every one-shot run needs a semantic identity so spend lands on a project and a positive ceiling so the launch can be preflighted against current usage.
          </p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend codex \\
    --tier low \\
    --identity port-daddy:docs:spawn-sync \\
    --budget 0.75 \\
    -- "Rewrite the website spawn docs so they match the daemon contract"`}
          </CodeBlock>
        </section>

        <section>
          <h2>2. Inspect the run</h2>
          <p>
            <code>pd spawn</code> returns the actual run result, and <code>pd spawned</code> lets you inspect what is still active or recently finished.
          </p>

          <CodeBlock language="bash">
            {`$ pd spawned
AGENT ID            BACKEND   MODEL                    STATUS      AGE
────────────────────────────────────────────────────────────────────────
spawned-8a2f0c1c    codex      gpt-5.4-mini           completed   12s`}
          </CodeBlock>
        </section>

        <section>
          <h2>3. Keep the task bounded</h2>
          <p>
            The current <code>pd spawn</code> surface does not expose file-scoping flags. If you need an Aider or Codex run to stay narrow, put the files and expected exit condition in the task itself.
          </p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend aider \\
    --identity port-daddy:ui:fleetbar \\
    --budget 1.25 \\
    -- "Only edit apps/FleetBar/FleetBar/CostStore.swift and apps/FleetBar/FleetBar/CostDashboard.swift. Use real fleet ceilings instead of a fake visual budget reference."`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  )
}
