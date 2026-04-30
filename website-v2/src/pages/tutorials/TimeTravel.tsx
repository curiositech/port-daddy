import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { ConsoleMotionFigure } from "@/components/tutorials/ConsoleMotionFigure";
import { ConsoleScreenshotFigure } from "@/components/tutorials/ConsoleScreenshotFigure";
import { CodeBlock } from "@/components/ui/CodeBlock";

export function TimeTravel() {
  return (
    <TutorialLayout
      title="Activity Log Inspection"
      description="When multiple agents work on the same project, the hardest question is what happened first. Use Port Daddy's immutable activity ledger to reconstruct the sequence."
      number={14}
      total={21}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: "Budgeted One-Shot Agents", href: "/tutorials/pd-spawn" }}
      next={{ title: "Reactive Pipelines", href: "/tutorials/pipelines" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The human reads the ledger in Activity and Flow</h2>
          <p>
            Event ordering matters because the failure usually lives between two
            actions. A person reconstructs that story in the Fleet Control
            Center&apos;s <strong>Activity</strong> and <strong>Flow</strong>{" "}
            surfaces, then drops to CLI or API queries only when the timeline
            needs exact filtering.
          </p>
          <ConsoleMotionFigure
            lightSrc="/media/landing-live-glory/port-daddy-live-glory-light.mp4"
            darkSrc="/media/landing-live-glory/port-daddy-live-glory-dark.mp4"
            lightPoster="/media/landing-live-glory/port-daddy-live-glory-light-poster.jpg"
            darkPoster="/media/landing-live-glory/port-daddy-live-glory-dark-poster.jpg"
            caption="Human control layer: the daemon-served Fleet Control Center is the first pass. Flow shows the current project story; Activity is where you verify the exact order of launches, notes, claims, and handoffs."
          />
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Pull the recent ledger, not just one event</h2>
          <p>
            Ask for a recent slice first. You want the surrounding sequence,
            because the bug is usually in the handoff between one action and the
            next.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd log --limit 6
Recent activity:
12:04:01 [session.start] planner claimed port 3102
12:04:03 [channel.publish] project:my-app:git:committed {"sha":"a13e7f2"}
12:04:05 [session.note] planner Started decomposition
12:04:11 [file.claim] planner src/routes/auth.ts
12:04:16 [spawn.complete] qa-review CLEAN cost=$0.06
12:04:19 [session.note] reviewer Waiting on auth test update

$ curl -s "http://127.0.0.1:9876/activity?limit=6"
{"items":[{"type":"session.start"},{"type":"channel.publish"},{"type":"session.note"},{"type":"file.claim"},{"type":"spawn.complete"},{"type":"session.note"}]}`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Correlate the CLI slice with the console</h2>
          <p>
            The CLI gives exact rows. The Fleet Control Center gives the human
            overview: which project was active, which agents were involved, and
            whether the same story is visible in <strong>Flow</strong> and
            <strong>Activity</strong>.
          </p>
          <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
            <ConsoleScreenshotFigure
              lightSrc="/media/landing-live-glory/fleetbar-menu-captured-light.png"
              darkSrc="/media/landing-live-glory/fleetbar-menu-captured-dark.png"
              alt="FleetBar entry view"
              caption="Human control layer: start in FleetBar to confirm the active project and jump into the same Fleet Control Center runtime before you dig into one timeline slice."
            />
            <ConsoleScreenshotFigure
              lightSrc="/media/landing-live-glory/live-flow-light.png"
              darkSrc="/media/landing-live-glory/live-flow-dark.png"
              alt="Fleet Control Center Flow surface"
              caption="Human control layer: Flow keeps the recent launches, touched agents, and run topology attached to the same project story as the ledger rows."
            />
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Diagnose the common failures</h2>
          <p>
            The activity ledger is strongest when two things disagree: a claim
            vanished, a session died mid-handoff, or a watcher fired in the
            wrong order. Look for the exact point where the sequence stopped
            making sense.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd log --type file.claim --limit 4
12:11:02 [file.claim] docs-agent website-v2/src/pages/tutorials/Fleet.tsx
12:11:09 [file.claim] qa-agent website-v2/src/pages/tutorials/Fleet.tsx

$ pd notes --limit 4
[note] docs-agent: Rewriting Fleet tutorial around Flow, Shipwright, YAML, and Activity.
[note] qa-agent: Attempted same file; backing off due to overlap.

$ pd salvage --project port-daddy --limit 3
No abandoned sessions in salvage queue.`}
          </CodeBlock>
          <p>
            When the sequence is clean, you can explain the issue in one
            sentence. When it is not, keep following the ledger until the
            contradiction is visible.
          </p>
        </section>
      </div>
    </TutorialLayout>
  );
}
