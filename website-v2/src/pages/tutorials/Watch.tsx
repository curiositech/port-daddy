import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Surface } from "@/components/ui/Surface";

export function Watch() {
  return (
    <TutorialLayout
      title="Observe Runtime Channels"
      description="Use pd watch to follow channel activity, inspect event pressure, and trigger bounded responses from scripts or agents."
      number={16}
      total={22}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: "Build Reactive Pipelines", href: "/tutorials/pipelines" }}
      next={{ title: "Plan Remote Coordination", href: "/tutorials/remote-harbors" }}
    >
      <div className="space-y-[var(--section-space-y)]">
        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">Watch channels instead of polling</h2>
          <p>
            <code>pd watch</code> subscribes to a channel and runs a local
            command whenever a message arrives. It is the simplest way to bridge
            Port Daddy events into scripts, build steps, notifications, or
            one-shot agent launches.
          </p>
          <p>
            Declared logical channels resolve against the current project by
            default. That means <code>git:committed</code> or{" "}
            <code>qa:findings</code> stays project-scoped unless you explicitly
            bypass that behavior with <code>--raw-channel</code>.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">1. Start with one bounded action</h2>
          <p>
            The safest watcher runs one script, on one channel, with a clear
            side effect.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd watch git:committed --exec ./scripts/run-tests.sh
Watching git:committed...`}
          </CodeBlock>
          <Surface depth="flat" radius="none" padding="lg">
            <p className="m-0">
              The daemon keeps the subscription alive and reconnects if the
              channel drops. Your script only runs when a message lands.
            </p>
          </Surface>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">2. Put limits around the response</h2>
          <p>
            Most watcher mistakes are about fan-out, not syntax. Set
            concurrency, timeout, and rate limits before you let a watch command
            trigger expensive work.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`pd watch qa:findings \\
  --exec "./scripts/post-findings.sh" \\
  --max-concurrent 1 \\
  --timeout 10000 \\
  --min-interval 5000
Watching qa:findings...`}
          </CodeBlock>
          <p>
            Use <code>--once</code> when you want one delivery and then an
            exit. Use <code>--raw-channel</code> only when you intentionally
            need the literal physical channel name.
          </p>
        </section>

        <section className="space-y-[var(--space-6)]">
          <h2 className="m-0">3. Use the message contract</h2>
          <p>
            When the exec command runs, Port Daddy passes the event through
            environment variables. That lets a tiny shell script react without
            needing to parse the SSE stream itself.
          </p>
          <CodeBlock copyable={false} language="bash">
            {`#!/usr/bin/env bash
set -euo pipefail

echo "channel: $PD_CHANNEL"
echo "content: $PD_MESSAGE_CONTENT"

pd note "watcher handled message from $PD_CHANNEL"
# Expected result: the script prints the channel/content and records one session note.`}
          </CodeBlock>
          <div className="grid gap-[var(--space-4)] md:grid-cols-2">
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>
                  <code>PD_MESSAGE</code>
                </strong>{" "}
                is the full JSON message payload.
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>
                  <code>PD_MESSAGE_CONTENT</code>
                </strong>{" "}
                is the extracted content field.
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>
                  <code>PD_CHANNEL</code>
                </strong>{" "}
                is the channel that fired.
              </p>
            </Surface>
            <Surface depth="raised" radius="none" padding="lg">
              <p className="m-0">
                <strong>
                  <code>PD_TIMESTAMP</code>
                </strong>{" "}
                is the event timestamp.
              </p>
            </Surface>
          </div>
        </section>
      </div>
    </TutorialLayout>
  );
}
