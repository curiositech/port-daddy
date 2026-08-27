import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function SessionPhases() {
  return (
    <TutorialLayout
      title="Model Session Phases"
      description="Move work through planning, implementation, review, and done states with phase-aware recovery and handoff evidence."
      number={9}
      total={22}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: "Resolve Services by Name", href: "/tutorials/dns" }}
      next={{ title: "Use Agent Inboxes", href: "/tutorials/inbox" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">Use the real phase names</h2>
          <p>
            Session phases are useful because other operators can tell whether a
            session is still planning, actively changing code, or already ready
            for review. They are also machine-readable, so salvage and project
            summaries can keep the work state honest.
          </p>
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>Active phases:</strong> <code>planning</code>,{" "}
                <code>in_progress</code>, <code>testing</code>,{" "}
                <code>reviewing</code>
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>Terminal phases:</strong> <code>completed</code>,{" "}
                <code>abandoned</code>
              </p>
            </Surface>
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Change phase when the work actually changes</h2>
          <p>
            The phase command is explicit. It updates a specific session and
            records the transition for later inspection.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd session phase session-a1b2c3d4 in_progress
pd session phase session-a1b2c3d4 testing
pd session phase session-a1b2c3d4 reviewing
# Expected result: the session timeline records each phase transition in order.`}
          </CodeBlock>
          <p>
            Keep the change paired with notes. A phase without a note tells the
            next operator less than it looks like it does.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Use phases to make handoffs legible</h2>
          <p>
            The value is not the state machine by itself. The value is that a
            reviewer, tester, or recovery agent can see where the previous
            operator stopped and what kind of work should happen next.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd note "JWT validation passes locally; moving to tests."
pd session phase session-a1b2c3d4 testing

pd note "Auth suite green. Ready for review."
pd session phase session-a1b2c3d4 reviewing
# Expected result: notes explain why the session moved to testing and then reviewing.`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Recover with the phase in view</h2>
          <p>
            Salvage is more useful when it inherits the last known work state.
            A recovered session in <code>testing</code> should not be treated
            like a fresh planning session.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd salvage
pd briefing
pd whoami
# Expected result: recovery surfaces show the previous phase before you decide the next action.`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              Port Daddy does not replace judgment here. The phase is a strong
              clue, not an excuse to skip reading notes, checking claims, and
              reconciling the actual repo state.
            </p>
          </Surface>
        </section>
      </div>
    </TutorialLayout>
  );
}
