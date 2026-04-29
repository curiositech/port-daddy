import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import {
  Activity,
  Zap,
  Shield,
  Layers,
  RefreshCw,
  CheckCircle2,
} from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function SessionPhases() {
  return (
    <TutorialLayout
      title="The Session State Machine"
      description="Coordination is a sequence of handoffs. Learn to drive agents through planning -> coding -> reviewing phases with auto-escrow and phase-aware salvage."
      number={9}
      total={20}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: "Identity Discovery", href: "/tutorials/dns" }}
      next={{ title: "Inbox & Messaging", href: "/tutorials/inbox" }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <RefreshCw className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">Beyond Flat Logs</h2>
          </div>
          <p>
            In a multi-agent swarm, "success" isn't a binary state. Work evolves
            through a lifecycle. <strong>Session Phases</strong> turn your
            agent's work into a manageable state machine, allowing the daemon to
            coordinate complex handoffs between specialists.
          </p>

          <Surface depth="raised" radius="none" className="p-5 space-y-4">
            <p className="text-[length:var(--type-panel-body-compact-size)] font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Swarm Progress
            </p>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col items-center gap-2">
                <div className="w-9 h-9  flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <CheckCircle2
                    size={16}
                    className="text-[var(--brand-secondary)]"
                  />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
                  Planning
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-[var(--border-default)]" />
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10  flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <Activity
                    size={18}
                    className="text-[var(--text-inverse)] animate-pulse"
                  />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">
                  Coding
                </span>
              </div>
              <div className="h-[1px] flex-1 bg-[var(--border-default)]" />
              <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
                <div className="w-9 h-9  flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
                  <Shield size={16} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest">
                  Reviewing
                </span>
              </div>
            </div>
          </Surface>
        </section>

        {/* Step 1: Transitions */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Zap className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">1. Transition the Session</h2>
          </div>

          <p>
            Agents should signal their current phase to the daemon. This allows
            other agents in the harbor to wait for specific state transitions
            before beginning their own sub-tasks.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd session phase coding\n\n✓ Session phase updated: planning -> coding\n✓ Broadcasted signal to 12 swarm radio subscribers.`}
          </CodeBlock>

          <Surface
            depth="flat"
            radius="none"
            padding="md"
            className="border-l-4 border-[var(--brand-secondary)]"
          >
            <p
              className="m-0 text-[length:var(--type-panel-body-compact-size)]"
              style={{ color: "var(--text-secondary)" }}
            >
              Phase transitions are recorded in the{" "}
              <strong>Immutable Timeline</strong>, providing a high-fidelity
              audit trail of the work lifecycle.
            </p>
          </Surface>
        </section>

        {/* Step 2: Phase-Aware Salvage */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Layers className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Smart Recovery</h2>
          </div>

          <p>
            If an agent crashes during the <code>coding</code> phase, the next
            agent to take over (via <code>pd salvage</code>) knows exactly where
            to resume--checking for half-written files and uncommitted diffs.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd salvage agent-7f3a\n\n✓ Preserved state found.\n✓ Phase: 'coding' detected.\n✓ Instruction: Checking local diffs before resuming...`}
          </CodeBlock>

          <p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
            <strong>Zero Context Loss</strong> -- Agents inherit the previous
            agent's notes, file claims, and current phase status.
            <strong> State Integrity</strong> -- The daemon ensures only one
            agent can "own" a specific phase at a time.
          </p>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="none" className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Zap size={18} className="text-[var(--brand-primary)]" />
            <p className="text-[length:var(--type-meta-size)] font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Orchestration Maturity
            </p>
          </div>
          <p className="m-0 text-[var(--text-secondary)]">
            Session phases turn multi-agent coordination from a series of lucky
            accidents into a <strong>reliable state machine</strong>. Your
            swarms converge on a result by methodically completing their
            assigned lifecycle. Every transition is recorded in an immutable
            audit trail.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
