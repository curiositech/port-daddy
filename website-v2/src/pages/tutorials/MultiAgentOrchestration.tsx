import { motion } from "framer-motion";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";
import { FileCode, MessageSquare, Users, Activity } from "lucide-react";

export function MultiAgentOrchestration() {
  return (
    <TutorialLayout
      title="Multi-Agent Coordination"
      description="Two agents, one harbor, visible handoffs. File claims show intent, session notes preserve context, and channels carry agent-to-agent signals."
      number={4}
      total={22}
      level="Intermediate"
      readTime="8 min read"
      prev={{
        title: "Semantic Identities",
        href: "/tutorials/semantic-identities",
      }}
      next={{ title: "Monorepo", href: "/tutorials/monorepo" }}
    >
      <motion.div className="space-y-12">
        {/* The Problem */}
        <section className="space-y-4">
          <motion.div className="flex items-center gap-3">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Users className="text-[var(--brand-primary)]" size={20} />
            </Surface>
            <motion.h2 className="m-0">The Shared-Work Problem</motion.h2>
          </motion.div>
          <motion.p>
            One agent can keep context in its own transcript. Several agents
            need a shared place to write intent, state, and handoffs. Inside a
            harbor, Port Daddy gives them <strong>file claims</strong>,{" "}
            <strong>pub/sub channels</strong>, and <strong>session notes</strong>
            that survive tool boundaries and crashes.
          </motion.p>
        </section>

        {/* File Claims */}
        <section className="space-y-4">
          <motion.div className="flex items-center gap-3">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <FileCode className="text-[var(--brand-accent)]" size={20} />
            </Surface>
            <motion.h2 className="m-0">1. File Claims: Who Owns What</motion.h2>
          </motion.div>
          <motion.p>
            Before modifying files, claim them. Claims are advisory — they warn
            other agents about conflicts without hard-locking anything.
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`$ pd begin --identity myapp:refactor --purpose "Refactor auth middleware" --lifecycle durable
$ pd session files claim src/middleware/*.ts src/routes/auth.ts
  Claimed 12 files. No conflicts.

# Meanwhile, Agent B tries to claim the same files:
$ pd session files claim src/middleware/auth.ts
  CONFLICT: src/middleware/auth.ts claimed by agent 'myapp:refactor'
  Holder session: session-a1b2c3d4`}</CodeBlock>
          <motion.p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-muted)]">
            Claims are released when the session ends (<code>pd done</code>) or
            when the agent crashes and enters the salvage queue.
          </motion.p>
        </section>

        {/* Pub/Sub */}
        <section className="space-y-4">
          <motion.div className="flex items-center gap-3">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <MessageSquare
                className="text-[var(--brand-secondary)]"
                size={20}
              />
            </Surface>
            <motion.h2 className="m-0">
              2. Pub/Sub: Signaling Between Agents
            </motion.h2>
          </motion.div>
          <motion.p>
            File claims handle ownership. Pub/sub handles communication. When
            Agent A finishes, it publishes a message. Agent B reacts instantly.
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`# Agent A finishes auth work and signals
$ pd pub myapp:events "auth-middleware-updated"

# Agent B was watching that channel
$ pd watch myapp:events --exec "npm test"
  Watching myapp:events...
  Message: "auth-middleware-updated"
  Running: npm test
  Tests passed (14/14)`}</CodeBlock>
          <motion.p>
            <code>pd watch</code> subscribes via SSE and runs your command on
            every message. No polling. No cron. Agent A publishes, Agent B
            reacts in sub-second time.
          </motion.p>
        </section>

        {/* Session Notes */}
        <section className="space-y-4">
          <motion.div className="flex items-center gap-3">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Activity className="text-[var(--brand-primary)]" size={20} />
            </Surface>
            <motion.h2 className="m-0">
              3. Session Notes: The Audit Trail
            </motion.h2>
          </motion.div>
          <motion.p>
            Every agent writes notes as it works. Notes are immutable — once
            written, they can&apos;t be edited or deleted. If an agent crashes,
            its notes survive for the next agent to read.
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`$ pd note "Found SQL injection in token validation. Fixing."
$ pd note "Replaced raw query with parameterized statement."
$ pd note "All 14 tests pass. Ready for review."

# Another agent (or human) reads the trail:
$ pd notes --session session-a1b2c3d4
  [14:22] Found SQL injection in token validation. Fixing.
  [14:25] Replaced raw query with parameterized statement.
  [14:31] All 14 tests pass. Ready for review.`}</CodeBlock>
        </section>

        {/* The Pattern */}
        <section className="space-y-4">
          <motion.h2 className="m-0">The Pattern</motion.h2>
          <motion.p>
            Every multi-agent workflow follows the same four steps:
          </motion.p>
          <CodeBlock copyable={false} language="bash">{`# 1. Start a session and claim files
$ pd begin --identity myapp:auth --purpose "Fix token validation" --lifecycle durable
$ pd session files claim src/auth/*.ts

# 2. Do the work, writing notes
$ pd note "Investigating CVE-2026-1234"
# ... agent does its thing ...
$ pd note "Patched. Tests green."

# 3. Signal completion
$ pd pub myapp:events "auth-fix-complete"

# 4. End session (releases claims, preserves notes)
$ pd done
# Expected result: claims release, the completion event is on myapp:events, and the note trail remains queryable.`}</CodeBlock>
          <motion.p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-muted)]">
            <strong>Claim, Work, Signal, Done.</strong> Every agent follows this
            lifecycle. Port Daddy handles conflict detection, crash recovery,
            and the audit trail.
          </motion.p>
        </section>

        {/* What's Next */}
        <section className="space-y-3">
          <motion.h2 className="m-0">What&apos;s Next</motion.h2>
          <motion.ul className="space-y-2 text-[var(--text-secondary)]">
            <motion.li>
              <a
                href="/tutorials/fleet"
                className="text-[var(--brand-primary)]"
              >
                Fleet Agents
              </a>{" "}
              — automate this pattern with background agents on every commit
            </motion.li>
            <motion.li>
              <a
                href="/tutorials/session-phases"
                className="text-[var(--brand-primary)]"
              >
                Session Phases
              </a>{" "}
              — track progress through planning → in_progress → testing → done
            </motion.li>
            <motion.li>
              <a
                href="/tutorials/pheromone"
                className="text-[var(--brand-primary)]"
              >
                Pheromone Trails
              </a>{" "}
              — ambient signals that let agents sense each other without talking
            </motion.li>
          </motion.ul>
        </section>
      </motion.div>
    </TutorialLayout>
  );
}
