import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { ConsoleMotionFigure } from "@/components/tutorials/ConsoleMotionFigure";
import { ConsoleScreenshotFigure } from "@/components/tutorials/ConsoleScreenshotFigure";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { PRODUCT_FEATURES } from "@/data/product";

const workflowSteps = [
  {
    title: "Start in FleetBar and Fleet Control Center",
    body: "FleetBar is the Mac entry. Fleet Control Center carries Flow, Activity, Agents, Resources, Inbox, Sorties, Shipwright, and YAML so the person can verify one coherent project story.",
    command: `open -a "Port Daddy"
pd status
Port Daddy is running
Fleet: 1 project(s), 8 agent(s), 3/8 launchable`,
  },
  {
    title: "Check readiness before launch",
    body: "Before any agent runs, verify backend readiness, budget posture, and Coordination Guard. The human review path is Shipwright first, then Flow and Resources.",
    command: `pd fleet models
claude-sdk   exact telemetry   ready
codex        exact telemetry   ready
gemini       missing API key   blocked

pd guard status
Coordination Guard: enforce`,
  },
  {
    title: "Let Shipwright propose the starting shape",
    body: "Shipwright surveys the repo, names suggested agents, estimates the envelope, and hands the person a plan that can be promoted into YAML and Flow.",
    command: `pd fleet init
Starter fleet written to pd-fleet.yml

pd fleet validate
Result: valid`,
  },
  {
    title: "Inspect the shared communication surfaces",
    body: "Sessions, notes, scoped channels, actor inboxes, claims, tuples, locks, and salvage are the durable communication layer between agents. The person checks Activity, Inbox, and Flow to make sure those surfaces agree.",
    command: `pd begin "first coordinated change"
session: session-my-app-first-coordinated-change-c1b28dd2

pd note "handoff ready"
Note recorded.

pd salvage --project my-app --limit 5
No abandoned sessions in salvage queue.`,
  },
  {
    title: "Open Developer telemetry",
    body: "The Developer pane shows which surfaces agents actually use: CLI, SDK, MCP, daemon routes, Fleet Console views, tokens, turns, tool calls, and Port Daddy-call cost versus spawned-agent work cost.",
    command: `# Open Fleet Control Center -> Developer
GET /usage/summary?window=7d
surfaces: cli, sdk, mcp, ui, daemon
cost scopes: port_daddy_call, agent_work`,
  },
] as const;

export function Primitives() {
  return (
    <TutorialLayout
      title="Walk the Product Primitives"
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
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">Start in the actual app, not a fictional diagram</h2>
          <p>
            This page exists to tie the public product claims back to the real
            app. The person starts in <strong>FleetBar</strong>, opens the
            daemon-served <strong>Fleet Control Center</strong>, and checks that{" "}
            <strong>Flow</strong>, <strong>Activity</strong>,{" "}
            <strong>Shipwright</strong>, and <strong>YAML</strong> all agree
            with the same runtime truth.
          </p>
          <ConsoleMotionFigure
            lightSrc="/media/landing-live-glory/port-daddy-live-glory-light.mp4"
            darkSrc="/media/landing-live-glory/port-daddy-live-glory-dark.mp4"
            lightPoster="/media/landing-live-glory/port-daddy-live-glory-light-poster.jpg"
            darkPoster="/media/landing-live-glory/port-daddy-live-glory-dark-poster.jpg"
            caption="Human control layer: the real Fleet console is the first proof surface. It should show the same project identity, readiness, and running story that the CLI commands report."
          />
          <div className="grid gap-[var(--space-5)] lg:grid-cols-3">
            <ConsoleScreenshotFigure
              lightSrc="/img/app-screens/fleetbar-native-shell-light.png"
              darkSrc="/img/app-screens/fleetbar-native-shell-dark.png"
              alt="FleetBar native shell"
              caption="FleetBar is the native entrance."
            />
            <ConsoleScreenshotFigure
              lightSrc="/img/tutorial-human-layer-control-center-light.png"
              darkSrc="/img/tutorial-human-layer-control-center-dark.png"
              alt="Fleet Control Center"
              caption="Fleet Control Center is the operator overview."
            />
            <ConsoleScreenshotFigure
              lightSrc="/img/app-screens/shipwright-control-light.png"
              darkSrc="/img/app-screens/shipwright-control-dark.png"
              alt="Shipwright control surface"
              caption="Shipwright turns cold start into a reviewable plan."
            />
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Run the cold-start loop</h2>
          <div className="divide-y divide-[var(--hairline)] border-y border-[var(--hairline)]">
            {workflowSteps.map((step, index) => (
              <div
                key={step.title}
                className="grid gap-[var(--space-4)] py-[var(--space-5)] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-[var(--space-8)]"
              >
                <div className="space-y-[var(--space-2)]">
                  <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--brand-primary)]">
                    Step {index + 1}
                  </p>
                  <h3 className="m-0">{step.title}</h3>
                  <p className="m-0">{step.body}</p>
                </div>
                <CodeBlock copyable={false} language="bash">
                  {step.command}
                </CodeBlock>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Map every primitive to a proof path</h2>
          <p>
            If a primitive has no app surface, no daemon evidence, and no
            inspectable command path, it should not be advertised. This table
            keeps the public list honest.
          </p>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>Primitive</th>
                  <th>Human surface</th>
                  <th>CLI proof path</th>
                </tr>
              </thead>
              <tbody>
                {PRODUCT_FEATURES.slice(0, 11).map((feature) => (
                  <tr key={feature.id}>
                    <td>{feature.title}</td>
                    <td>
                      {"surface" in feature && feature.surface === "Shipwright"
                        ? "Shipwright"
                        : "surface" in feature && feature.surface === "FleetBar"
                          ? "FleetBar"
                          : "Fleet Control Center"}
                    </td>
                    <td>
                      <code>{feature.cli}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Confirm the same story in the app</h2>
          <p>
            When the loop is healthy, the person should be able to move from{" "}
            <strong>Shipwright</strong> into <strong>Flow</strong>, then into{" "}
            <strong>Activity</strong>, <strong>Inbox</strong>,{" "}
            <strong>Developer</strong>, and <strong>YAML</strong> without
            losing the project identity, runtime truth, or cost story.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd fleet up
SUCCESS: fleet started for project my-app

$ pd sortie run --backend codex --budget 0.50 -- "Check docs drift and summarize product-truth gaps"
SUCCESS: sortie launched
session: sortie-91a0ef22
INFO: status running

# Open Fleet Control Center → Shipwright, Flow, Activity, Inbox, and YAML`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  );
}
