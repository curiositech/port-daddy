import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Harbors() {
  return (
    <TutorialLayout
      title="Start Inside a Harbor"
      description="Create the project boundary first, then run agents, sessions, ports, channels, and recovery inside a named permission scope."
      number={1}
      total={21}
      level="Beginner"
      readTime="8 min read"
      next={{ title: "Install the Local Control Plane", href: "/tutorials/getting-started" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">The harbor is the project boundary</h2>
          <p>
            A harbor is the named boundary where Port Daddy scopes work. When
            agents, sessions, notes, claims, channels, services, and recovery
            records belong to the same harbor, the rest of the project can tell
            what happened and who should touch it next.
          </p>
          <p>
            That is why the product is harbor-first rather than port-first. A
            port is one resource. A harbor is the coordination boundary that
            makes the rest of the resources legible.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Create the shared project boundary</h2>
          <p>
            Start by naming the place the work should live. For most repos, that
            is one stable project harbor.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd harbor create my-app:main
pd harbors
pd harbor show my-app:main
Harbor created: my-app:main
Harbors (1):
  my-app:main  (0 members, expires: never)
Harbor: my-app:main`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              The common case is one harbor for the project and narrower harbors
              only when a task needs a tighter permission scope.
            </p>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Start a session, then enter it with that agent</h2>
          <p>
            Entering a harbor needs an agent identity. The usual flow is to
            start the session first, then attach that active agent to the
            project harbor.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd begin "Add password reset flow" --identity my-app:codex:auth
pd harbor enter my-app:main
pd note "Reset email template is implemented; API handler remains."
SUCCESS: Agent Add password reset flow ready
Entered harbor: my-app:main
SUCCESS: Note added to session session-add-password-reset-flow`}
          </CodeBlock>
          <p>
            Now the session, notes, claims, and later salvage all line up inside
            the same project boundary.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Narrow the scope only when the task needs it</h2>
          <p>
            Sensitive or time-boxed work can use a separate harbor with explicit
            capabilities and an expiry. The current CLI flag is{" "}
            <code>--expires</code>.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd harbor create my-app:security-review \\
  --cap "code:read,notes:write" \\
  --expires 2h

pd harbor enter my-app:security-review --agent my-app:reviewer
pd harbor leave my-app:security-review --agent my-app:reviewer
Harbor created: my-app:security-review
Entered harbor: my-app:security-review
Left harbor: my-app:security-review`}
          </CodeBlock>
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                Use the project harbor for normal collaborative work.
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                Use narrower harbors for review, incident response, or other
                bounded sensitive tasks.
              </p>
            </Surface>
          </div>
        </section>
      </div>
    </TutorialLayout>
  );
}
