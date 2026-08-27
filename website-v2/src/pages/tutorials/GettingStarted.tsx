import { Link } from "react-router-dom";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function GettingStarted() {
  return (
    <TutorialLayout
      title="Install and Verify the Daemon"
      description="Install the daemon, open FleetBar, join the project harbor, and confirm it is running before asking agents to work."
      number={2}
      total={22}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: "Start Inside a Harbor", href: "/tutorials/harbors" }}
      next={{ title: "Name Work Inside the Harbor", href: "/tutorials/semantic-identities" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">What you are installing</h2>
          <p>
            Port Daddy is a local coordination layer for agents. The daemon
            keeps the shared facts that separate tools otherwise lose:
            sessions, notes, claims, locks, channels, services, spawned jobs,
            and recovery state.
          </p>
          <p>
            It is not a whole agent framework by itself. It is the local layer
            that makes different tools cooperate on one machine without relying
            on a human to replay terminal history.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Install Port Daddy</h2>
          <Surface depth="raised" radius="none" padding="lg">
            <p className="mt-0">
              <strong>Default path</strong>
            </p>
            <CodeBlock copyable={false} language="bash">
              {`brew install curiositech/tap/port-daddy
pd setup`}
            </CodeBlock>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Verify the install</h2>
          <p>
            Before you launch agents or start background automation, confirm the
            app, daemon, hooks, MCP server, skills, and project wiring agree.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd doctor
pd status
# Expected result: FleetBar, the daemon, hooks, MCP, and skills are healthy.`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              If you have the Mac app installed, this is also the point where
              opening FleetBar should agree with the CLI about the current
              daemon.
            </p>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Create the project boundary and first session</h2>
          <p>
            The first session gives your shell an agent identity. After that,
            you can attach that active agent to the project harbor and confirm
            the working context.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd harbor create my-app:main

pd begin "Bootstrap auth service" --identity my-app:api --lifecycle durable
pd harbor enter my-app:main
pd whoami
# Expected result: the active agent identity is my-app:api inside harbor my-app:main.`}
          </CodeBlock>
          <p>
            If you want to inspect the harbor itself, use{" "}
            <code>pd harbor show my-app:main</code> or <code>pd harbors</code>.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">4. Finish cleanly</h2>
          <p>
            End the session when the first slice is done so the next operator
            sees a clean handoff instead of a stale active shell.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd note "Bootstrap complete. Harbor is ready for auth work."
pd done "Initial setup complete"
# Expected result: note recorded, session completed, active context cleared.`}
          </CodeBlock>
        </section>

        <section className="space-y-[var(--space-5)]">
          <h2 className="m-0">What&apos;s next</h2>
          <div className="grid gap-[var(--space-4)] sm:grid-cols-3">
            <Link
              to="/tutorials/semantic-identities"
              className="border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block text-[var(--text-primary)]">
                <strong>Semantic Identities</strong>
              </span>
              <span className="mt-[var(--space-2)] block text-[var(--text-secondary)]">
                Give services stable names so agents stop depending on raw host
                and port guesses.
              </span>
            </Link>
            <Link
              to="/tutorials/multi-agent"
              className="border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block text-[var(--text-primary)]">
                <strong>Multi-Agent Work</strong>
              </span>
              <span className="mt-[var(--space-2)] block text-[var(--text-secondary)]">
                Coordinate two agents in one repo with visible claims, notes,
                and channels.
              </span>
            </Link>
            <Link
              to="/tutorials/fleet"
              className="border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block text-[var(--text-primary)]">
                <strong>Fleet Agents</strong>
              </span>
              <span className="mt-[var(--space-2)] block text-[var(--text-secondary)]">
                Move recurring coordination work into daemon-visible automation.
              </span>
            </Link>
          </div>
        </section>
      </div>
    </TutorialLayout>
  );
}
