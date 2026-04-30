import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { ConsoleScreenshotFigure } from "@/components/tutorials/ConsoleScreenshotFigure";
import { CodeBlock } from "@/components/ui/CodeBlock";

export function MultiAgentOrchestration() {
  return (
    <TutorialLayout
      title="Multi-Agent Coordination"
      description="Two agents, one harbor, visible handoffs. File claims show intent, session notes preserve context, and channels carry agent-to-agent signals."
      number={4}
      total={21}
      level="Intermediate"
      readTime="8 min read"
      prev={{
        title: "Semantic Identities",
        href: "/tutorials/semantic-identities",
      }}
      next={{ title: "Monorepo", href: "/tutorials/monorepo" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The human checks Flow before trusting the handoff</h2>
          <p>
            Two agents can coordinate without a person standing over the shell,
            but the person still needs proof. The Fleet Control Center&apos;s{" "}
            <strong>Flow</strong>, <strong>Activity</strong>, and{" "}
            <strong>Inbox</strong> surfaces are the human read model for who
            owns the work, what just changed, and where the handoff landed.
          </p>
          <div className="grid gap-[var(--space-5)] lg:grid-cols-2">
            <ConsoleScreenshotFigure
              lightSrc="/media/landing-live-glory/live-flow-light.png"
              darkSrc="/media/landing-live-glory/live-flow-dark.png"
              alt="Fleet Control Center Flow surface"
              caption="Human control layer: Flow keeps the active project, agents, and recent runtime story attached to one inspectable place."
            />
            <ConsoleScreenshotFigure
              lightSrc="/img/tutorial-human-layer-control-center-light.png"
              darkSrc="/img/tutorial-human-layer-control-center-dark.png"
              alt="Fleet Control Center operator entrance"
              caption="Human control layer: Fleet Control Center is where the person sees blockers, next actions, and whether the current harbor story is coherent before a review or handoff."
            />
          </div>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Claim the file before both agents touch it</h2>
          <p>
            Claims are the first signal. They tell the second agent that the
            work is already in motion before both sessions start patching the
            same surface.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd begin --identity myapp:auth --purpose "Refactor auth middleware"
session: session-myapp-auth-4f9ea2cb

$ pd session files claim src/middleware/auth.ts src/routes/auth.ts
Claimed 2 files. No conflicts.

$ pd session files claim src/middleware/auth.ts
CONFLICT: src/middleware/auth.ts claimed by myapp:auth
holder session: session-myapp-auth-4f9ea2cb`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Leave notes the next agent can actually use</h2>
          <p>
            Claims stop silent overlap. Notes carry the work forward. If the
            first session crashes or pauses, the second agent should be able to
            read the note trail and continue without guessing what was already
            learned.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd note "Found SQL injection in token validation. Replacing raw query."
Note recorded.

$ pd note "Parameterised the token lookup and added regression coverage."
Note recorded.

$ pd notes --limit 3
[14:22] Found SQL injection in token validation. Replacing raw query.
[14:25] Parameterised the token lookup and added regression coverage.`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Signal the next step on a project-scoped channel</h2>
          <p>
            When the first agent is ready for the next stage, publish the event
            instead of hoping the second agent notices a git diff on its own.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`$ pd pub project:myapp:events "auth-fix-complete"
Published to project:myapp:events

$ pd watch project:myapp:events --exec "npm test -- auth"
[watch] subscribed to project:myapp:events
[watch] message: auth-fix-complete
[watch] running: npm test -- auth
Tests passed (14/14)`}
          </CodeBlock>
          <p>
            That is the full pattern: claim, note, publish, then let the
            second agent react with its own session and evidence trail.
          </p>
        </section>
      </div>
    </TutorialLayout>
  );
}
