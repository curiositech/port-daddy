import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import { Surface } from "@/components/ui/Surface";
import {
  Eye,
  Zap,
  Terminal,
  Shield,
  Share2,
  RefreshCw,
  Layers,
  ArrowDown,
} from "lucide-react";

export function Watch() {
  return (
    <TutorialLayout
      title="Swarm Observation"
      description="Coordination requires constant vigilance. Learn to use pd watch to monitor Swarm Radio channels and execute automated actions the moment a signal fires."
      number={16}
      total={21}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Reactive Pipelines", href: "/tutorials/pipelines" }}
      next={{
        title: "Multiplayer Localhost",
        href: "/tutorials/remote-harbors",
      }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Eye className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">Beyond Polling</h2>
          </div>
          <p>
            In a reactive swarm, agents shouldn't waste cycles polling for state
            changes. <strong>Swarm Observation</strong> allows you to define
            "listeners" that stay dormant until a specific signal hits a{" "}
            <strong>Swarm Radio</strong> channel. When the signal fires, Port
            Daddy executes your script instantly.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Zap
                size={18}
                className="text-[var(--brand-secondary)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>Sub-50ms Reaction</strong> -- The moment an agent
                publishes a note or a message, your watcher script is spawned by
                the daemon.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Layers
                size={18}
                className="text-[var(--brand-secondary)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>Scriptable Swarms</strong> -- Use any local binary or
                shell script as a reactive "agent" that handles infrastructure
                tasks.
              </p>
            </div>
          </div>
        </section>

        {/* Step 1: Watching */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Terminal className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Summon a Watcher</h2>
          </div>

          <p>
            Use the <code>watch</code> command to link a channel to a local
            action. We'll watch for a "build-ready" signal and trigger an
            automated test suite.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`$ pd watch swarm:builds \\
    --exec "npm test" \\
    --filter "payload.status == 'ready'"`}
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            Watchers run in the background. The daemon maintains the connection
            to Swarm Radio and ensures your script is only executed when the
            filter criteria are met.
          </p>
        </section>

        {/* Step 2: Advanced Feedback */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Share2 className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Feedback Loops</h2>
          </div>

          <p>
            Watcher scripts can report their own results back to the swarm by
            calling <code>pd pub</code> or <code>pd add-note</code>, creating a
            self-organizing feedback loop.
          </p>

          <div className="space-y-3">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="p-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-2 h-2  bg-[var(--brand-secondary)]" />
                <span className="text-[length:var(--type-panel-body-compact-size)] font-bold">
                  Agent 'coder' publishes "fix-done"
                </span>
              </div>
              <Badge variant="teal">Event</Badge>
            </Surface>
            <div className="flex justify-center">
              <ArrowDown size={14} className="text-[var(--text-muted)]" />
            </div>
            <Surface
              depth="raised"
              radius="none"
              className="p-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <Terminal size={14} className="text-[var(--brand-primary)]" />
                <span className="text-[length:var(--type-panel-body-compact-size)] font-bold text-[var(--brand-primary)]">
                  Watcher triggers './run-ci.sh'
                </span>
              </div>
              <Badge variant="gold">Action</Badge>
            </Surface>
            <div className="flex justify-center">
              <ArrowDown size={14} className="text-[var(--text-muted)]" />
            </div>
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="p-3 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <RefreshCw size={14} className="text-[var(--text-muted)]" />
                <span className="text-[length:var(--type-panel-body-compact-size)] font-bold text-[var(--text-primary)]">
                  CI publishes "tests-pass" to Swarm Radio
                </span>
              </div>
              <Badge variant="default">Loop</Badge>
            </Surface>
          </div>
        </section>

        {/* Vision Callout */}
        <Surface
          depth="raised"
          radius="none"
          className="p-6 text-center space-y-4 relative overflow-hidden"
        >
          <Badge
            variant="teal"
            className="px-4 py-1 text-[10px] font-black uppercase tracking-widest"
          >
            Autonomous Maturity
          </Badge>
          <p
            className="text-[length:var(--type-panel-title-nav-size)] font-bold m-0"
            style={{ color: "var(--text-primary)" }}
          >
            Always Watching.
          </p>
          <p className="max-w-xl mx-auto text-[var(--text-secondary)] m-0">
            Observation is a first-class citizen. Your swarm shouldn't just
            act--it should <strong>perceive</strong>. The watch command gives
            your infrastructure the eyes it needs to stay in sync with your
            agents.
          </p>
          <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
            <Shield size={14} />
            Real-Time Event Stream
          </div>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
