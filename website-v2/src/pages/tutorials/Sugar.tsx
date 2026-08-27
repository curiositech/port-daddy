import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Sugar() {
  return (
    <TutorialLayout
      title="Use Operator Shortcuts"
      description="Use pd begin, pd done, pd whoami, and pd with-lock as the daily command layer over the lower-level primitives."
      number={11}
      total={22}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: "Use Agent Inboxes", href: "/tutorials/inbox" }}
      next={{ title: "Run Event-Triggered Agents", href: "/tutorials/always-on" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The daily Port Daddy loop</h2>
          <p>
            The low-level API is useful when you are wiring tools together, but
            most day-to-day operator work is simpler than that. The CLI has a
            short command layer for the common loop: start visible work, check
            context, take exclusive control of scarce resources, and finish
            cleanly.
          </p>
          <Surface depth="raised" radius="none" padding="lg">
            <div className="space-y-[var(--space-4)]">
              <p className="m-0">
                <strong>
                  <code>pd begin</code>
                </strong>{" "}
                registers the agent, starts the session, and stores local
                context for later commands.
              </p>
              <p className="m-0">
                <strong>
                  <code>pd whoami</code>
                </strong>{" "}
                shows the current session, identity, phase, and note count.
              </p>
              <p className="m-0">
                <strong>
                  <code>pd with-lock</code>
                </strong>{" "}
                runs one command while holding a lock, then releases it on exit.
              </p>
              <p className="m-0">
                <strong>
                  <code>pd done</code>
                </strong>{" "}
                closes the session, writes the final note, and clears local
                context.
              </p>
            </div>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Start visible work</h2>
          <p>
            Use <code>pd begin</code> when you are about to change files or
            leave durable project state behind. It is the fastest way to become
            visible to the rest of the fleet.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd begin "Review flaky auth tests" \\
  --identity my-app:test-hunter \\
  --lifecycle durable \\
  --files tests/auth/login.test.ts
SUCCESS: Agent Review flaky auth tests ready and tests/auth/login.test.ts claimed.`}
          </CodeBlock>
          <p>
            After that, commands such as <code>pd note</code>,{" "}
            <code>pd whoami</code>, and <code>pd done</code> can use the stored
            session context instead of making you repeat IDs every time.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Check the current context</h2>
          <p>
            Before you publish a note, change phase, or leave the shell running
            for a while, confirm which agent and session you are actually in.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd whoami

pd note "Running the auth suite before editing login flow"
# Expected result: whoami shows the active session, then the note is recorded on that session.`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              If there is no active session, <code>pd whoami</code> tells you
              that directly. That is the signal to start with{" "}
              <code>pd begin</code> instead of doing invisible work.
            </p>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Protect scarce operations</h2>
          <p>
            Locks are for things that should not race: migrations, release
            steps, generated artifacts, or any other command that should have
            one owner while it runs.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd with-lock db-migrations npm run migrate
# Expected result: the migration command runs while the db-migrations lock is held, then releases it.`}
          </CodeBlock>
          <p>
            If the command exits or crashes, Port Daddy still cleans up the
            lock according to its TTL. That keeps a dead shell from blocking the
            rest of the project forever.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">4. Finish or recover</h2>
          <p>
            End the session when the task is done. If the shell disappears
            first, the next operator can inspect the salvage queue instead of
            guessing from Git diff alone.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd done "Auth test fixes landed with notes and claims released"

pd salvage
# Expected result: the finished session is absent from active work and salvage has no stranded copy.`}
          </CodeBlock>
        </section>
      </div>
    </TutorialLayout>
  );
}
