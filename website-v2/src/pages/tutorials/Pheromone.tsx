import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Pheromone() {
  return (
    <TutorialLayout
      title="Use Ambient Attention Signals"
      description="Attach decaying numeric signals to files, sessions, or ideas so agents can prioritize work without extra chat traffic."
      number={19}
      total={22}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: "Run Background Fleets", href: "/tutorials/fleet" }}
      next={{ title: "Walk the 11 Product Primitives", href: "/tutorials/primitives" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">Pheromones are lightweight priority signals</h2>
          <p>
            Pheromones are numeric annotations that decay over time. They do
            not replace notes, claims, or messages. They answer a narrower
            question: what looks hot, risky, or worth attention right now?
          </p>
          <p>
            The current CLI nouns are <code>spray</code>, <code>show</code>,{" "}
            <code>ls</code>, and <code>files</code>. Avoid teaching older
            made-up verbs such as &ldquo;sniff.&rdquo;
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Spray a signal onto an entity</h2>
          <p>
            Signals can live on files, services, sessions, projects, or agents.
            The strength must stay between 0 and 1.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd pheromone spray services myapp:api:main urgency 0.8
pd pheromone spray agents reviewer-42 quality 0.95
pd pheromone file src/auth/login.ts 0.7
SUCCESS: pheromone signals recorded for service, agent, and file targets.`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              Use this when the signal helps routing or prioritization. Do not
              use it as a substitute for a real handoff note.
            </p>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Read the current strength</h2>
          <p>
            The returned value already reflects decay. A hot signal cools off if
            nobody refreshes it.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd pheromone show services myapp:api:main
pd pheromone ls
# Expected result: current decayed strength and the hottest active signals are listed.`}
          </CodeBlock>
          <p>
            This is good for ambient triage: which service is under pressure,
            which agent has recent quality evidence, or which session still
            looks active enough to inspect first.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Use the file heat view for contention</h2>
          <p>
            The most practical pheromone surface today is the file heat map. It
            combines file claim activity with heat scoring so you can see where
            multiple sessions are likely to collide.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd pheromone files
pd pheromone files --path src/auth --depth 2
# Expected result: file heat rows include path, score, and conflict status when claims overlap.`}
          </CodeBlock>
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>High heat</strong> means recent concentrated attention.
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>
                  <code>conflict: true</code>
                </strong>{" "}
                means multiple active sessions have claims on the same file.
              </p>
            </Surface>
          </div>
        </section>
      </div>
    </TutorialLayout>
  );
}
