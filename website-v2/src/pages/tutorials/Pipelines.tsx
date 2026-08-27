import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import {
  Zap,
  Terminal,
  Layers,
  RefreshCw,
  ArrowDown,
  Radio,
} from "lucide-react";
import { Surface } from "@/components/ui/Surface";

export function Pipelines() {
  return (
    <TutorialLayout
      title="Reactive Workflows"
      description="Use pd watch and pd spawn to build event-driven workflows today. Declarative reactive pipelines are planned for v4."
      number={15}
      total={22}
      level="Advanced"
      readTime="10 min read"
      prev={{
        title: "Activity Log Inspection",
        href: "/tutorials/time-travel",
      }}
      next={{ title: "Swarm Observation", href: "/tutorials/watch" }}
    >
      <div className="space-y-12">
        {/* Planned Feature Notice */}
        <p
          className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-accent)] pl-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <strong>Planned for v4:</strong> declarative reactive pipelines, where
          you map a channel to an action and the app manages the rule. Today you
          get the same result with <code>pd watch</code> and{" "}
          <code>pd spawn</code>, which both ship now.
        </p>

        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Layers className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">Reactive Workflows Today</h2>
          </div>
          <p>
            Port Daddy's pub/sub channels, <code>pd watch</code>, and{" "}
            <code>pd spawn</code> give you the building blocks for event-driven
            agent workflows right now. An agent publishes a message, a watcher
            picks it up, and a script or new agent responds.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Zap
                size={18}
                className="text-[var(--brand-secondary)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>pd watch</strong> -- Subscribe to any pub/sub channel
                via SSE. Run a script whenever a message arrives.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <RefreshCw
                size={18}
                className="text-[var(--brand-accent)] mt-0.5 shrink-0"
              />
              <p className="m-0 text-[length:var(--type-panel-body-compact-size)]">
                <strong>pd spawn</strong> -- Launch AI agents (ollama, claude,
                aider, gemini, or custom) with full Port Daddy coordination
                wired in.
              </p>
            </div>
          </div>
        </section>

        {/* Step 1: pd watch */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Radio className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Watch a Channel</h2>
          </div>

          <p>
            Use <code>pd watch</code> to subscribe to a pub/sub channel and run
            a script every time a message arrives. The message content is passed
            via environment variables.
          </p>

          <CodeBlock copyable={false} language="bash">
            {`# Watch the "test:fail" channel, run a fix script on each message
$ pd watch test:fail --exec ./scripts/auto-fix.sh
Watching test:fail...

# Environment variables available in your script:
#   PD_MESSAGE         — full JSON message
#   PD_MESSAGE_CONTENT — message body text
#   PD_CHANNEL         — channel name (test:fail)
#   PD_TIMESTAMP       — ISO timestamp`}
          </CodeBlock>

          <p
            className="m-0 text-[length:var(--type-panel-body-compact-size)] border-l-4 border-[var(--brand-secondary)] pl-4"
            style={{ color: "var(--text-secondary)" }}
          >
            <code>pd watch</code> uses SSE with automatic reconnection. It stays
            running in the background, reacting to every message on the channel.
          </p>
        </section>

        {/* Step 2: Combining watch + spawn */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center  border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]">
              <Terminal className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Chain Watch + Spawn</h2>
          </div>

          <p>
            Combine <code>pd watch</code> with <code>pd spawn</code> to create
            reactive agent chains. When one agent finishes and publishes a
            signal, a watcher can spawn the next agent in the pipeline.
          </p>

          <div className="space-y-3">
            <Surface
              depth="raised"
              radius="none"
              className="flex items-center gap-3 p-4"
            >
              <Badge variant="teal" className="shrink-0">
                Step 1
              </Badge>
              <div className="flex-1">
                <p className="font-bold m-0 text-[length:var(--type-panel-body-compact-size)]">Agent publishes result</p>
                <code className="text-[length:var(--type-meta-size)]">
                  pd pub task:ready "auth module complete"
                </code>
              </div>
            </Surface>
            <div className="flex justify-center">
              <ArrowDown size={14} className="text-[var(--text-muted)]" />
            </div>
            <Surface
              depth="raised"
              radius="none"
              className="flex items-center gap-3 p-4"
            >
              <Badge variant="teal" className="shrink-0">
                Step 2
              </Badge>
              <div className="flex-1">
                <p className="font-bold m-0 text-[length:var(--type-panel-body-compact-size)]">Watcher triggers spawn</p>
                <code className="text-[length:var(--type-meta-size)]">
                  pd watch task:ready --exec 'pd spawn --backend aider --
                  "Review $PD_MESSAGE_CONTENT"'
                </code>
              </div>
            </Surface>
          </div>

          <CodeBlock copyable={false} language="bash">
            {`# A complete reactive workflow in three terminals:

# Terminal 1: Watcher spawns a reviewer when code is ready
pd watch code:ready --exec 'pd spawn --backend aider -- "Review changes in $PD_MESSAGE_CONTENT"'

# Terminal 2: Watcher spawns tests when review passes
pd watch review:pass --exec './scripts/run-tests.sh'

# Terminal 3: Your coding agent publishes when done
pd pub code:ready "src/auth/login.ts"
# Expected result: the reviewer watcher starts first; the test watcher only runs after review:pass is published.`}
          </CodeBlock>
        </section>

        {/* Roadmap Callout */}
        <Surface
          depth="raised"
          radius="none"
          className="p-6 text-center space-y-4 relative overflow-hidden"
        >
          <p
            className="text-[length:var(--type-panel-title-nav-size)] font-bold m-0"
            style={{ color: "var(--text-primary)" }}
          >
            Declarative pipelines, planned for v4
          </p>
          <p className="max-w-xl mx-auto text-[var(--text-secondary)] m-0">
            In v4, you will define pipeline rules in a config file -- mapping
            channels to actions. The app will run health checks and stop runaway
            spawning. Until then, <code>pd watch</code> and <code>pd spawn</code>{" "}
            do the same job with shell scripts.
          </p>
        </Surface>
      </div>
    </TutorialLayout>
  );
}
