import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { ConsoleMotionFigure } from "@/components/tutorials/ConsoleMotionFigure";
import { ConsoleScreenshotFigure } from "@/components/tutorials/ConsoleScreenshotFigure";
import { CodeBlock } from "@/components/ui/CodeBlock";

export function Fleet() {
  return (
    <TutorialLayout
      title="Fleet: Agents That Run While You Sleep"
      description="Declare your background agent fleet in YAML, bind it to project events, and keep QA, docs, and research work continuously inspectable."
      number={18}
      total={21}
      level="Intermediate"
      readTime="12 min read"
      prev={{
        title: "Multiplayer Localhost",
        href: "/tutorials/remote-harbors",
      }}
      next={{ title: "Pheromone Trails", href: "/tutorials/pheromone" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The human reviews the fleet in Shipwright, Flow, and YAML</h2>
          <p>
            A fleet is not a headless rumor. The person responsible for the
            project reviews the proposal in <strong>Shipwright</strong>, checks
            the running story in <strong>Flow</strong>, watches outcomes in{" "}
            <strong>Activity</strong>, and reads the concrete declaration in{" "}
            <strong>YAML</strong>. That is the human layer. The CLI exists to
            write or validate the same runtime story, not to replace it.
          </p>
          <ConsoleMotionFigure
            lightSrc="/media/landing-live-glory/port-daddy-live-glory-light.mp4"
            darkSrc="/media/landing-live-glory/port-daddy-live-glory-dark.mp4"
            lightPoster="/media/landing-live-glory/port-daddy-live-glory-light-poster.jpg"
            darkPoster="/media/landing-live-glory/port-daddy-live-glory-dark-poster.jpg"
            caption="Human control layer: the real Fleet console is where the proposal becomes an operated system. The app moves through Flow, Shipwright, and the rest of the control plane with the live daemon attached."
          />
          <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
            <ConsoleScreenshotFigure
              lightSrc="/img/app-screens/shipwright-control-light.png"
              darkSrc="/img/app-screens/shipwright-control-dark.png"
              alt="Shipwright control surface"
              caption="Human control layer: Shipwright is where a person reviews the starter fleet, budget envelope, and role ownership before the YAML goes live."
            />
            <ConsoleScreenshotFigure
              lightSrc="/media/landing-live-glory/live-flow-light.png"
              darkSrc="/media/landing-live-glory/live-flow-dark.png"
              alt="Fleet Control Center Flow surface"
              caption="Human control layer: Flow is the place to confirm that the running fleet, active project, and agent topology match the YAML the person approved."
            />
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Write the fleet YAML as a reviewable contract</h2>
          <p>
            The point of <code>pd-fleet.yml</code> is not to hide automation.
            It makes the runtime legible. Triggers, identities, and outputs live
            in a file the team can inspect in <strong>YAML</strong> and commit
            like any other source surface.
          </p>
          <CodeBlock copyable={false} language="yaml">
            {`fleet:
  name: my-project
  harbor: "{project}:fleet"

  agents:
    qa:
      trigger: git:committed
      backend: codex
      model: gpt-5.4-mini
      identity: "{project}:fleet:qa"
      prompt: |
        Review the most recent commit and leave a note about regressions.
      on_success: publish qa:clean
      on_failure: publish qa:findings

    docs:
      trigger: git:committed
      backend: claude-cli
      model: sonnet
      identity: "{project}:fleet:docs"
      prompt: |
        Compare docs with the latest commit and update stale product claims.

  channels:
    git:committed:
      description: "Published after a successful local commit"
      consumers: [qa, docs]`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Validate before you wake the fleet</h2>
          <p>
            Validation proves the daemon can actually operate what the YAML
            declares. If readiness or identity is wrong, fail closed here
            instead of launching background work that the person cannot trust.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd fleet validate
INFO: validating pd-fleet.yml
SUCCESS: fleet file valid
Project: port-daddy
Agents: 2
Readiness: pass
Scoped channels: git:committed, qa:clean, qa:findings`}
          </CodeBlock>
          <p>
            That is the same moment the person should compare{" "}
            <strong>Shipwright</strong> and <strong>YAML</strong>: the proposal
            and the checked-in declaration should still be telling the same
            story.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Bring the fleet up and inspect it in the console</h2>
          <p>
            Starting the fleet should produce a visible runtime, not a pile of
            hidden shells. After the daemon accepts it, the person can open{" "}
            <strong>Flow</strong>, <strong>Agents</strong>,{" "}
            <strong>Activity</strong>, and <strong>YAML</strong> to verify that
            the project is running the expected services.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd fleet up
SUCCESS: fleet started for project port-daddy
Agents launched: qa, docs
Watcher subscriptions: project:port-daddy:git:committed
Status: healthy

$ pd fleet status
port-daddy:fleet:qa    idle      watching project:port-daddy:git:committed
port-daddy:fleet:docs  idle      watching project:port-daddy:git:committed`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">4. Follow one commit all the way through</h2>
          <p>
            The strongest proof is one real project event. Publish the commit,
            watch the fleet react, and confirm that the resulting notes and
            completions become visible in <strong>Activity</strong> and{" "}
            <strong>Flow</strong>.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd pub project:port-daddy:git:committed '{"sha":"a13e7f2","message":"tighten tutorial surfaces"}'
Published to project:port-daddy:git:committed

$ pd spawned
agent-2f084a9b  codex:gpt-5.4-mini  completed  cost=$0.08
agent-7bc1ae04  sonnet              completed  cost=$0.12

$ pd notes --limit 4
[note] port-daddy:fleet:qa: No regression found in tutorial shell cleanup.
[note] port-daddy:fleet:docs: Updated fleet tutorial wording to match console surfaces.`}
          </CodeBlock>
          <p>
            When those rows appear, the tutorial is no longer describing a
            fantasy. The YAML, the daemon, and the Fleet console are all
            describing the same system.
          </p>
        </section>
      </div>
    </TutorialLayout>
  );
}
