import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import { Surface } from "@/components/ui/Surface";

export function GettingStarted() {
  return (
    <TutorialLayout
      title="Install the Local Control Plane"
      description="Install Port Daddy, open FleetBar, enter the project harbor, and verify the daemon before agents start work."
      number={2}
      total={20}
      level="Beginner"
      readTime="10 min read"
      prev={{
        title: "Start Inside a Harbor",
        href: "/tutorials/harbors",
      }}
      next={{
        title: "Name Work Inside the Harbor",
        href: "/tutorials/semantic-identities",
      }}
    >
      <motion.div className="space-y-[var(--section-space-y)]">
        {/* What is Port Daddy */}
        <section className="space-y-[var(--space-6)]">
          <motion.h2 className="m-[var(--space-0)]">
            What is Port Daddy?
          </motion.h2>
          <motion.p>
            Port Daddy is a local control plane for agent coordination. The
            daemon keeps the shared facts that separate tools cannot reliably
            share by themselves: the active harbor, sessions, notes, file
            claims, locks, channels, inboxes, services, spawned jobs, resource
            pressure, and salvage records.
          </motion.p>
          <motion.p>
            Ports are one useful primitive in that system, but they are not the
            center of the product. The center is accountable cooperation: agents
            can see what other agents are doing, talk through named channels and
            inboxes, leave recoverable notes, and continue work after crashes
            without asking a human to replay a terminal transcript.
          </motion.p>
          <motion.p>
            Port Daddy is not a high-level orchestration framework like CrewAI
            or LangGraph. It is the coordination kernel that sits underneath
            whatever agent framework you use. Think of it as a local
            communication substrate for agent work on your machine.
          </motion.p>
        </section>

        {/* Installation */}
        <section className="space-y-[var(--space-7)]">
          <motion.h2 className="m-[var(--space-0)]">1. Install</motion.h2>

          <div className="space-y-[var(--space-4)]">
            <Surface
              depth="raised"
              radius="none"
              className="space-y-[var(--space-3)] p-[var(--space-6)]"
            >
              <Badge variant="teal">npm (recommended)</Badge>
              <CodeBlock copyable={false} language="bash">{`npm install -g port-daddy`}</CodeBlock>
            </Surface>
            <Surface
              depth="raised"
              radius="none"
              className="space-y-[var(--space-3)] p-[var(--space-6)]"
            >
              <Badge variant="default">From source</Badge>
              <CodeBlock copyable={false} language="bash">{`git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
npm install
npm link`}</CodeBlock>
            </Surface>
          </div>

          <Surface
            depth="raised"
            radius="none"
            className="space-y-[var(--space-4)] p-[var(--space-8)]"
          >
            <Badge variant="default">Verification</Badge>
            <CodeBlock copyable={false} language="bash">{`pd start
pd harbor enter my-app:main
open -a FleetBar`}</CodeBlock>
            <motion.p className="mb-[var(--space-0)] text-[length:var(--type-small-size)] text-[var(--text-muted)]">
              The daemon is running, FleetBar opens the Fleet Control Center,
              and your shell is attached to the project harbor.
            </motion.p>
          </Surface>
        </section>

        {/* Semantic Tokens */}
        <section className="space-y-[var(--space-7)]">
          <motion.h2 className="m-[var(--space-0)]">
            2. Confirm the Harbor Context
          </motion.h2>

          <motion.p>
            Before agents edit files, confirm which harbor and session context
            they will write into. The point is not to memorize a port; it is to
            make the work visible to the other agents on the project.
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`$ pd status
Port Daddy is running
Runtime: nominal
Fleet: 1 project(s), 8 agent(s)

$ pd harbor show my-app:main
Harbor: my-app:main
Sessions: 0 active
Channels: project-scoped

$ pd briefing
No active blockers. Start a session before editing.`}</CodeBlock>

          <motion.p className="text-[length:var(--type-small-size)] text-[var(--text-muted)]">
            FleetBar should show the same project and harbor. If the shell and
            the Mac app disagree, fix that before launching agents.
          </motion.p>
        </section>

        {/* Start a Session */}
        <section className="space-y-[var(--space-6)]">
          <motion.h2 className="m-[var(--space-0)]">
            3. Start a Session
          </motion.h2>

          <motion.p>
            Sessions track what each agent is doing inside the harbor. They hold
            notes, file claims, timestamps, and handoff evidence — the minimum
            record another agent needs if the first one crashes.
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`$ pd begin --identity myapp:api --purpose "Building auth endpoints"
  Session started: session-a1b2c3d4
  Agent registered with heartbeat

$ pd note "Implementing JWT validation for /login inside my-app:main"
  Note added to session

$ pd done
  Session completed. Notes preserved.`}</CodeBlock>

          <motion.p className="text-[length:var(--type-small-size)] text-[var(--text-muted)]">
            If an agent crashes instead of calling <code>pd done</code>, its
            session enters the salvage queue. Another agent can pick up the work
            with <code>pd salvage claim</code>.
          </motion.p>
        </section>

        {/* What's Next */}
        <section className="space-y-[var(--space-5)]">
          <motion.h2 className="m-[var(--space-0)]">What&apos;s Next</motion.h2>
          <motion.div className="grid gap-[var(--space-4)] sm:grid-cols-3">
            <Link
              to="/tutorials/semantic-identities"
              className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                Semantic Identities
              </span>
              <span className="mt-[var(--space-2)] block text-[length:var(--type-small-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                Give services stable names, then query the graph without caring
                which port moved.
              </span>
            </Link>
            <Link
              to="/tutorials/multi-agent"
              className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                Multi-Agent Work
              </span>
              <span className="mt-[var(--space-2)] block text-[length:var(--type-small-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                Use claims, notes, and radio channels so two agents can touch
                one repo without guessing.
              </span>
            </Link>
            <Link
              to="/tutorials/fleet"
              className="border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] p-[var(--space-4)] no-underline transition-colors hover:bg-[var(--interactive-hover)]"
            >
              <span className="block font-display text-[length:var(--type-panel-title-card-size)] font-black leading-[var(--leading-card)] text-[var(--text-primary)]">
                Fleet Agents
              </span>
              <span className="mt-[var(--space-2)] block text-[length:var(--type-small-size)] leading-[var(--leading-body)] text-[var(--text-secondary)]">
                Put recurring coordination work behind daemon-visible triggers
                instead of invisible background scripts.
              </span>
            </Link>
          </motion.div>
        </section>
      </motion.div>
    </TutorialLayout>
  );
}
