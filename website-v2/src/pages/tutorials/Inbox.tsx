import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Inbox() {
  return (
    <TutorialLayout
      title="Use Agent Inboxes"
      description="Separate the human control layer from the agent execution layer, send a durable handoff to one named agent, and keep direct coordination readable instead of burying it in logs."
      number={10}
      total={22}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Session Phases", href: "/tutorials/session-phases" }}
      next={{ title: "Sugar Commands", href: "/tutorials/sugar" }}
    >
      <div className="space-y-[var(--space-8)]">
        <section className="space-y-[var(--space-4)]">
          <p>
            This page only makes sense if we keep two layers separate. A{" "}
            <strong>human operator</strong> decides who should own the next
            task. A <strong>named agent</strong> receives that assignment in its
            own durable lane and works from there. The inbox is that lane.
          </p>

          <Surface depth="raised" radius="none" padding="lg">
            <div className="grid gap-[var(--space-4)] md:grid-cols-2">
              <div className="space-y-[var(--space-2)]">
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Human Control Layer
                </p>
                <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  A release lead, reviewer, or operator chooses the next owner,
                  sends the assignment, and inspects whether the handoff landed.
                </p>
              </div>
              <div className="space-y-[var(--space-2)]">
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Agent Execution Layer
                </p>
                <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  The receiving agent watches its own inbox, reads the message,
                  and carries the task forward. That inbox belongs to one agent,
                  not the whole fleet.
                </p>
              </div>
            </div>
          </Surface>

          <Surface depth="flat" radius="none" padding="lg">
            <div className="space-y-[var(--space-4)]">
              <div>
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Human Layer In The Console UI
                </p>
                <p className="mb-0 mt-[var(--space-2)] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  These are real Port Daddy console surfaces. The operator
                  entrance is where a human sees launch blockers and next
                  actions; the Fleet Flow surface is where a human inspects the
                  running system after assigning work.
                </p>
              </div>

              <div className="grid gap-[var(--space-4)] lg:grid-cols-2">
                <figure className="m-0 space-y-[var(--space-2)]">
                  <img
                    src="/img/tutorial-human-layer-control-center.webp"
                    alt="Real Fleet Control Center operator entrance from the local Port Daddy daemon, showing budget limits, what's ready to run, the project queue, and next actions."
                    className="block w-full border-2 border-[var(--border-strong)]"
                    loading="lazy"
                  />
                  <figcaption className="font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
                    Human control layer: the real daemon-served operator
                    entrance, captured from the local Fleet Control Center.
                  </figcaption>
                </figure>

                <figure className="m-0 space-y-[var(--space-2)]">
                  <img
                    src="/img/app-screens/fleet-flow-light.webp"
                    alt="Real Fleet Flow console view showing project and agent activity inside the Port Daddy app."
                    className="block w-full border-2 border-[var(--border-strong)]"
                    loading="lazy"
                  />
                  <figcaption className="font-sans text-[length:var(--type-small-size)] leading-[var(--leading-body-compact)] text-[var(--text-muted)]">
                    Human control layer: Fleet Flow gives the operator the live
                    system view after the handoff is assigned.
                  </figcaption>
                </figure>
              </div>
            </div>
          </Surface>

          <Surface depth="flat" radius="none" padding="lg">
            <div className="grid gap-[var(--space-4)] md:grid-cols-2">
              <div className="space-y-[var(--space-2)]">
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Use Inbox When
                </p>
                <ul className="m-0 space-y-[var(--space-2)] pl-[var(--space-5)]">
                  <li>one agent owns the next move</li>
                  <li>the handoff should persist until read</li>
                  <li>the sender identity should stay attached</li>
                </ul>
              </div>
              <div className="space-y-[var(--space-2)]">
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Use Pub/Sub Instead
                </p>
                <ul className="m-0 space-y-[var(--space-2)] pl-[var(--space-5)]">
                  <li>many listeners should react</li>
                  <li>the signal is broadcast, not assigned</li>
                  <li>you are driving a watcher or workflow chain</li>
                </ul>
              </div>
            </div>
          </Surface>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">1. Start The Agent-Owned Receiver</h2>
          <p>
            Begin on the <strong>agent layer</strong>. In the receiving
            terminal, watch the QA agent&apos;s inbox. This is the dedicated
            lane where a direct assignment should appear.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal B — QA agent
$ pd inbox watch --agent QA-REVIEWER

Watching inbox for agent QA-REVIEWER...
Waiting for unread messages...`}
          </CodeBlock>
          <p>
            This terminal belongs to the named agent. It is not a generic
            operator monitor and not a broadcast channel listener.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">2. Send The Handoff From The Human Layer</h2>
          <p>
            Switch to the <strong>human control layer</strong>. The release lead
            decides that QA owns the next step and sends one direct message to
            that agent. In the CLI today, the sender identity comes from the
            current agent context or the <code>AGENT_ID</code> environment
            variable.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal A — release lead
$ AGENT_ID=RELEASE-LEAD pd inbox send QA-REVIEWER \
  "Check migration 0142 on staging before release. Focus on lock ordering and rollback."

Message sent to QA-REVIEWER`}
          </CodeBlock>
          <p>
            This is the point of the inbox: one sender, one owner, one durable
            assignment.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">3. Confirm What The Agent Sees</h2>
          <p>
            Back in the <strong>agent layer</strong>, the watcher receives the
            handoff with attribution. The agent can now act without scraping a
            shared log or guessing who asked.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal B — QA agent
Watching inbox for agent QA-REVIEWER...

[12:04:38] <RELEASE-LEAD> Check migration 0142 on staging before release. Focus on...
Check migration 0142 on staging before release. Focus on lock ordering and rollback.`}
          </CodeBlock>

          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
              What This Solves
            </p>
            <div className="mt-[var(--space-3)] grid gap-[var(--space-3)] md:grid-cols-3">
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                The human layer makes ownership explicit instead of tossing work
                into shared noise.
              </p>
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                The agent layer gets a durable, attributable instruction instead
                of a vague event stream.
              </p>
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                The handoff survives long enough to be read, resumed, or audited
                later.
              </p>
            </div>
          </Surface>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">4. Keep Inbox And Channels Separate</h2>
          <p>
            The inbox is not a shared bus. If one agent owns the work, send to
            the inbox. If several listeners should react, publish to a channel.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Human assigns work to one agent
AGENT_ID=RELEASE-LEAD pd inbox send QA-REVIEWER "Review the staging migration"
Message sent to QA-REVIEWER

# System broadcasts a shared event
pd pub release:staging '{"event":"migration-ready","build":"0142"}'
SUCCESS: published to release:staging`}
          </CodeBlock>
          <p>
            Humans assign through inboxes. Shared runtime events flow through
            channels. If those two layers blur together, the coordination model
            stops making sense.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">5. Extend The Pattern</h2>
          <p>
            This same split works for review requests, salvage recovery,
            operator escalation, and CI handoffs. A human or another tool
            decides who owns the work. The named agent receives it in a
            durable lane.
          </p>
          <Surface depth="raised" radius="none" padding="lg">
            <div className="grid gap-[var(--space-4)] md:grid-cols-2">
              <div>
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Good Inbox Cases
                </p>
                <ul className="mb-0 mt-[var(--space-3)] space-y-[var(--space-2)] pl-[var(--space-5)]">
                  <li>review requests</li>
                  <li>salvage handoffs</li>
                  <li>operator escalation to one agent</li>
                  <li>task results that need a named owner</li>
                </ul>
              </div>
              <div>
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Next Step
                </p>
                <p className="mb-0 mt-[var(--space-3)] text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  Pair inboxes with session phases and notes so the assignment,
                  the work state, and the completion trail stay attached to the
                  same agent owner.
                </p>
              </div>
            </div>
          </Surface>
        </section>
      </div>
    </TutorialLayout>
  );
}
