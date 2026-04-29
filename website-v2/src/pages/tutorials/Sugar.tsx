import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Zap, Terminal, Lock, Sparkles } from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function Sugar() {
  return (
    <TutorialLayout
      title="Sugar Commands"
      description="Coordination shouldn't be a chore. Learn to use Port Daddy's high-level wrappers to claim ports, acquire locks, and manage sessions with zero friction."
      number={11}
      total={20}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: "Inbox & Messaging", href: "/tutorials/inbox" }}
      next={{ title: "Spawn + Watch Pattern", href: "/tutorials/always-on" }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Sparkles className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">Invisible Infrastructure</h2>
          </div>
          <p>
            While Port Daddy provides a robust REST API for deep integrations,
            most humans and CLI-native agents prefer our{" "}
            <strong>Sugar Commands</strong>. These are high-level wrappers that
            combine multiple primitives into a single, intuitive action.
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            <strong>Zero Config</strong> -- Sugar commands auto-detect your
            project root and existing sessions so you don't have to pass IDs.
            <strong> Safe Defaults</strong> -- Built-in timeouts and retry logic
            ensure that your agent scripts are resilient to network blips.
          </p>
        </section>

        {/* Step 1: Managed Sessions */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Zap className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. pd begin & pd done</h2>
          </div>

          <p>
            Instead of manually creating a session and registering an agent, use{" "}
            <code>pd begin</code>. It writes the session state to a local file,
            allowing all subsequent commands to "just work."
          </p>

          <CodeBlock language="bash">
            {`$ pd begin --identity swarm:analyst\\
    --purpose "Analyze log files"\\
    --files "logs/*.log"`}
          </CodeBlock>

          <Surface
            depth="flat"
            radius="none"
            padding="md"
            className="border-l-4 border-[var(--brand-secondary)]"
          >
            <p
              className="m-0 text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              When the agent finishes, <code>pd done</code> releases all file
              claims and port assignments cleanly, closing the session timeline.
            </p>
          </Surface>
        </section>

        {/* Step 2: Atomic Locks */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] flex items-center justify-center">
              <Lock className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. pd with-lock</h2>
          </div>

          <p>
            Safely run any terminal command under a distributed lock. If the
            command fails, the daemon still ensures the lock is released after
            its TTL.
          </p>

          <CodeBlock language="bash">
            {`$ pd with-lock db-migration -- npm run migrate\n\n✓ Lock acquired: db-migration\n✓ Running: npm run migrate...\n✓ Command complete. Lock released.`}
          </CodeBlock>

          <Surface depth="raised" radius="none" className="p-5 space-y-3">
            <p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Productivity HUD
            </p>
            <div className="space-y-2">
              <Surface
                depth="flat"
                radius="none"
                padding="none"
                className="flex items-center justify-between p-3"
              >
                <div className="flex items-center gap-3">
                  <Terminal size={14} className="text-[var(--text-muted)]" />
                  <code className="text-xs">pd whoami</code>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  Identify current agent
                </span>
              </Surface>
              <Surface
                depth="flat"
                radius="none"
                padding="none"
                className="flex items-center justify-between p-3"
              >
                <div className="flex items-center gap-3">
                  <Terminal size={14} className="text-[var(--text-muted)]" />
                  <code className="text-xs">pd salvage</code>
                </div>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  Recover orphaned work
                </span>
              </Surface>
            </div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="none" className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Zap size={18} className="text-[var(--brand-primary)]" />
            <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">
              Efficiency Maturity
            </p>
          </div>
          <p className="m-0 text-[var(--text-secondary)]">
            Multi-agent coordination is complex, but the interface shouldn't be.
            Port Daddy's sugar commands turn deep infrastructure primitives into
            a "standard library" for your agent swarm prompts. Zero-config
            coordination means agents can focus on their task, not on plumbing.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
