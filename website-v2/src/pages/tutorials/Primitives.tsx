import { motion } from "framer-motion";
import { MonitorCog, RadioTower, ShieldCheck, Wrench } from "lucide-react";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";
import { PRODUCT_FEATURES } from "@/data/product";

const workflowSteps = [
  {
    title: "Open FleetBar and the dashboard",
    icon: MonitorCog,
    body: "FleetBar is the Mac entrance. It opens the daemon-served Fleet Control Center, so Flow, Agents, Resources, Spawned Runs, Shipwright, Activity, Inbox, and YAML all report the same project identity.",
    command: "pd setup --project ~/coding/my-app",
  },
  {
    title: "Check readiness before launch",
    icon: ShieldCheck,
    body: "Backend readiness, resource pressure, and Coordination Guard are preflight checks. A good launch starts by proving keys, dependencies, model rates, budget ceilings, and claims are visible.",
    command: "pd status\npd fleet models\npd guard status",
  },
  {
    title: "Let Shipwright connect cold start to Flow",
    icon: Wrench,
    body: "Shipwright surveys the repo, proposes a starter fleet, simulates the envelope, then sends you back to Flow, Agents, YAML, Spawned Runs, and Resources.",
    command: "pd fleet init\npd fleet validate",
  },
  {
    title: "Use shared agent communication",
    icon: RadioTower,
    body: "Sessions, notes, scoped channels, actor inboxes, claims, tuples, locks, and salvage records are how agents communicate across separate tools and crashes.",
    command:
      'pd begin "first coordinated change" --lifecycle durable\npd note "handoff ready"\npd salvage --project my-app',
  },
] as const;

export function Primitives() {
  return (
    <TutorialLayout
      title="Walk the 11 Product Primitives"
      description="Use the Mac app, Fleet Control Center, Shipwright, and CLI checks to see where every public primitive lives."
      number={20}
      total={21}
      level="Beginner"
      readTime="12 min read"
      prev={{
        title: "Use Ambient Attention Signals",
        href: "/tutorials/pheromone",
      }}
      next={{
        title: "Pipe Agent Conversations",
        href: "/tutorials/pd-tube",
      }}
    >
      <motion.div className="space-y-16">
        <section className="space-y-6">
          <motion.h2 className="m-0">What this tutorial proves</motion.h2>
          <motion.p>
            The home page names eleven primitives. This walkthrough ties each
            one to the Mac app, the daemon, or a command you can run today, so
            the website is not asking visitors to believe in invisible features.
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`pd setup --project ~/coding/my-app
pd status
pd briefing
pd fleet models
pd guard status
Port Daddy is running
Coordination Guard: enforce`}</CodeBlock>
        </section>

        <section className="space-y-8">
          <motion.h2 className="m-0">1. Run the cold-start loop</motion.h2>
          <div className="grid gap-6">
            {workflowSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <Surface
                  key={step.title}
                  depth="raised"
                  radius="none"
                  className="p-6 space-y-4"
                >
                  <div className="flex items-start gap-4">
                    <Surface
                      depth="flat"
                      radius="none"
                      padding="none"
                      className="flex h-12 w-12 shrink-0 items-center justify-center"
                    >
                      <Icon className="text-[var(--brand-primary)]" size={22} />
                    </Surface>
                    <div className="space-y-2">
                      <p className="m-0 font-mono text-[length:var(--type-meta-size)] font-black uppercase tracking-[0.22em] text-[var(--brand-primary)]">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <motion.h3 className="m-0 text-2xl">
                        {step.title}
                      </motion.h3>
                      <motion.p className="m-0">{step.body}</motion.p>
                    </div>
                  </div>
                  <CodeBlock copyable={false} language="bash">{step.command}</CodeBlock>
                </Surface>
              );
            })}
          </div>
        </section>

        <section className="space-y-8">
          <motion.h2 className="m-0">
            2. Map every primitive to a feature
          </motion.h2>
          <motion.p>
            Keep this table beside the Mac Preview page. If a primitive has no
            app view, command, or inspection path, it should not be on the
            public site.
          </motion.p>
          <div className="grid gap-4">
            {PRODUCT_FEATURES.map((feature, index) => (
              <Surface
                key={feature.id}
                depth="raised"
                radius="none"
                className="p-6 space-y-4"
              >
                <div className="grid gap-3 md:grid-cols-[4rem_1fr]">
                  <div className="font-mono text-[length:var(--type-panel-title-nav-size)] font-black text-[var(--brand-primary)]">
                    {String(index + 1).padStart(2, "0")}
                  </div>
                  <div className="space-y-2">
                    <motion.h3 className="m-0 text-2xl">
                      {feature.title}
                    </motion.h3>
                    <motion.p className="m-0">{feature.description}</motion.p>
                    <CodeBlock copyable={false} language="bash">{feature.cli}</CodeBlock>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        </section>

        <section className="space-y-6">
          <motion.h2 className="m-0">
            3. Inspect the result in the app
          </motion.h2>
          <motion.p>
            After setup and readiness checks, open FleetBar or the Fleet Control
            Center. Spawned work should preserve enough artifacts and history to
            be inspected later. Resources should show pressure and spend. Activity,
            Inbox, notes, claims, tuples, and salvage should make agent-to-agent
            communication visible instead of buried in one terminal transcript.
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`PD_URL="\${PORT_DADDY_URL:-$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://127.0.0.1:#')}"
open "$PD_URL/fleet-ui/?surface=shipwright"
pd fleet up
pd spawn --backend codex --budget 0.50 --purpose "Check docs drift" -- "Summarize product-truth gaps"
# Expected result: Fleet Control Center opens, the fleet starts, and the spawned run appears in activity.`}</CodeBlock>
        </section>
      </motion.div>
    </TutorialLayout>
  );
}
