import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Inbox() {
  return (
    <TutorialLayout
      title="Use Verified Actor Inboxes"
      description="Create two verified actor contexts, send a bounded durable handoff to one exact canonical actor, and acknowledge it without deleting the audit trail."
      number={10}
      total={21}
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
                  A release lead, reviewer, or operator chooses the next owner.
                  Port Daddy turns that choice into a message for one exact,
                  daemon-minted actor ID.
                </p>
              </div>
              <div className="space-y-[var(--space-2)]">
                <p className="m-0 font-sans text-[length:var(--type-meta-size)] font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                  Agent Execution Layer
                </p>
                <p className="m-0 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
                  The receiving actor presents its stored credential to read or
                  acknowledge the message. A display name, alias, request body,
                  or loopback connection cannot stand in for that credential.
                </p>
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
                  <li>one verified actor owns the next move</li>
                  <li>the exact canonical recipient is known</li>
                  <li>daemon-attributed provenance should stay attached</li>
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
          <h2 className="m-0">1. Start The Verified Receiver</h2>
          <p>
            Begin on the <strong>agent layer</strong>. In Terminal B, start the
            receiver&apos;s durable session. The daemon mints the actor identity,
            binds it to a live inbox in this harbor, and stores the one-time
            credential in that terminal&apos;s local context.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal B — receiver
$ pd begin "Review migration 0142" \\
    --identity qa:reviewer \\
    --lifecycle durable \\
    --sidequest "Inbox tutorial receiver"

# Output
agent    QA Reviewer (ACTOR7K4M2...)
session  Review migration 0142 (session-review-...)`}
          </CodeBlock>
          <p>
            <code>qa:reviewer</code> is useful display metadata. It is not the
            recipient authority. Copy the canonical <code>ACTOR7K4M2...</code>
            ID that the daemon returned; aliases cannot be substituted later.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">2. Send From Another Verified Actor</h2>
          <p>
            In Terminal A, begin the sender&apos;s session, then target the exact
            canonical receiver ID. The CLI presents Terminal A&apos;s stored actor
            credential; the body contains only bounded message content. It
            cannot choose its own sender, wake the receiver, or claim operator
            authority.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal A — sender
$ pd begin "Coordinate staging release" \\
    --identity release:lead \\
    --lifecycle durable \\
    --sidequest "Inbox tutorial sender"

$ pd inbox send ACTOR7K4M2... \
  "Check migration 0142 on staging before release. Focus on lock ordering and rollback."

Message sent to ACTOR7K4M2...`}
          </CodeBlock>
          <p>
            Port Daddy records the canonical sender from the verified
            credential. A caller-provided alias or sender field has zero
            authority and is not persisted as the party.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">3. Read And Acknowledge As The Owner</h2>
          <p>
            Back in Terminal B, read the inbox. The command uses the exact
            receiver credential stored by <code>pd begin</code>. Another actor,
            an anonymous HTTP caller, or a same-named alias is rejected.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`# Terminal B — receiver
$ pd inbox --unread --limit 1

# Output
✉ [12:04:38] <ACTOR9Q2D6...> Check migration 0142 on staging before release...
1 message(s)

$ pd inbox read-all
Marked 1 message(s) as read`}
          </CodeBlock>

          <p>
            Acknowledgement preserves the durable audit trail. Destructive
            inbox clear is not a public API. Anonymous external ingress, where
            enabled, is stamped as external provenance, rate-limited and
            bounded, and has no wake or terminal authority.
          </p>

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
                The actor layer gets a durable, daemon-attributed instruction
                instead of a self-asserted sender string.
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
            {`# A verified actor assigns work to one exact actor
pd inbox send ACTOR7K4M2... "Review the staging migration"
Message sent to ACTOR7K4M2...

# System broadcasts a shared event
pd pub release:staging '{"event":"migration-ready","build":"0142"}'
SUCCESS: published to release:staging`}
          </CodeBlock>
          <p>
            Directed actor handoffs use inboxes. Shared runtime events flow
            through channels. A channel subscription is never a shortcut around
            inbox owner authentication.
          </p>
        </section>

        <section className="space-y-[var(--space-4)]">
          <h2 className="m-0">5. Extend The Pattern</h2>
          <p>
            This same split works for review requests, salvage recovery,
            operator escalation, and CI handoffs. A human or another tool
            decides who owns the work. The daemon resolves that decision to one
            canonical live actor in the correct harbor or fails closed.
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
