import { motion } from "framer-motion";
import { TutorialLayout } from "@/components/tutorials/TutorialLayout";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { Badge } from "@/components/ui/Badge";
import { Surface } from "@/components/ui/Surface";
import {
  Bot,
  GitCommit,
  Clock,
  Radio,
  Eye,
  Zap,
  Shield,
  FileText,
  ArrowRight,
} from "lucide-react";

export function Fleet() {
  return (
    <TutorialLayout
      title="Fleet: Agents That Run While You Sleep"
      description="Declare your background agent fleet in YAML. Wire it to git commits. Watch QA, docs, and idea engines run automatically on every push."
      number={18}
      total={21}
      level="Intermediate"
      readTime="12 min read"
      prev={{
        title: "Multiplayer Localhost",
        href: "/tutorials/remote-harbors",
      }}
      next={{ title: "Pheromone Trails", href: "/tutorials/pheromone" }}
    >
      <motion.div className="space-y-16">
        {/* Intro */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Bot className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Why a Fleet?</motion.h2>
          </motion.div>
          <motion.p>
            You commit code. Then you wait. Someone has to review it, update the
            docs, check test coverage, keep the roadmap honest. What if agents
            did all of that the moment you pushed?
          </motion.p>
          <motion.p>
            A <strong>fleet</strong> is a set of background AI agents declared
            in a YAML file. Each agent has a job, a trigger, and a communication
            channel. When something happens &mdash; a git commit, a timer, a
            message from another agent &mdash; the right agents wake up and do
            their work.
          </motion.p>
          <motion.p>
            No cron scripts. No CI/CD pipelines. One YAML file. Your agents run
            while you sleep.
          </motion.p>
          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
            <Surface
              depth="raised"
              radius="none"
              className="p-6 text-center space-y-3"
            >
              <motion.p className="text-[length:var(--type-meta-size)] font-bold m-0">
                Trigger on Events
              </motion.p>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                Agents fire when messages hit pub/sub channels
              </motion.p>
            </Surface>
            <Surface
              depth="raised"
              radius="none"
              className="p-6 text-center space-y-3"
            >
              <motion.p className="text-[length:var(--type-meta-size)] font-bold m-0">
                Run on a Timer
              </motion.p>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                Cron-style intervals for periodic work
              </motion.p>
            </Surface>
            <Surface
              depth="raised"
              radius="none"
              className="p-6 text-center space-y-3"
            >
              <motion.p className="text-[length:var(--type-meta-size)] font-bold m-0">
                Agents Talk to Agents
              </motion.p>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                One agent&apos;s output triggers another
              </motion.p>
            </Surface>
          </motion.div>
        </section>

        {/* Step 1: Writing Your Fleet YAML */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <FileText className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Write Your Fleet YAML</motion.h2>
          </motion.div>

          <motion.p>
            Create a file called <code>pd-fleet.yml</code> at your project root.
            This is the manifest &mdash; it declares every agent, what triggers
            it, and what it does.
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`fleet:
  name: my-project
  harbor: "{project}:fleet"    # Shared identity for all fleet agents

  agents:
    qa:
      trigger: git:committed             # Fires when someone commits
      backend: cloudflare
      model: '@cf/qwen/qwen3-30b-a3b-fp8'
      prompt: |
        Review the most recent commit. Read every changed file.
        If you find bugs, write a test that exposes each one.
        If clean, say CLEAN.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    docs:
      trigger: git:committed             # Same trigger, different job
      backend: cloudflare
      model: '@cf/qwen/qwen3-30b-a3b-fp8'
      prompt: |
        Check if docs match the code. Update anything stale.
      identity: "{project}:fleet:docs"

    gardener:
      schedule: "*/10 * * * *"           # Every 10 minutes
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status
      identity: "{project}:fleet:gardener"

  channels:
    git:committed:
      description: "Fired after a successful commit"
      consumers: [qa, docs]

    qa:clean:
      description: "QA found no issues"

    qa:findings:
      description: "QA found bugs"`}</CodeBlock>

          <motion.p>Three things to notice:</motion.p>
          <motion.ul className="space-y-2 text-[var(--text-secondary)]">
            <motion.li>
              <strong>Triggers</strong> are pub/sub channel names. When a
              message appears on <code>git:committed</code>, both{" "}
              <code>qa</code> and <code>docs</code> fire simultaneously.
            </motion.li>
            <motion.li>
              <strong>Schedules</strong> are cron expressions. The gardener runs
              every 10 minutes regardless of what else happens.
            </motion.li>
            <motion.li>
              <strong>Channels</strong> declare the communication topology.
              Agents publish results; other agents or watchers consume them.
            </motion.li>
          </motion.ul>

          <Surface depth="raised" radius="none" className="p-6 space-y-3">
            <motion.p className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0 text-[var(--brand-accent)]">
              Template Variables
            </motion.p>
            <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
              <code>{"{project}"}</code> resolves to your directory name.{" "}
              <code>{"{branch}"}</code> is the current git branch.{" "}
              <code>{"{sha}"}</code> is the current commit hash. These resolve
              when the fleet starts, so each agent gets an identity scoped to
              your project.
            </motion.p>
          </Surface>
        </section>

        {/* Step 2: Wire Git */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <GitCommit className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Wire Git to the Fleet</motion.h2>
          </motion.div>

          <motion.p>
            The fleet triggers on <code>git:committed</code>, but who publishes
            to that channel? You do &mdash; with a git post-commit hook. This
            runs automatically after every <code>git commit</code>.
          </motion.p>

          <CodeBlock copyable={false} language="bash">{`#!/usr/bin/env zsh
# Fire-and-forget: publish commit info to Port Daddy
PD_URL="\${PORT_DADDY_URL:-\$(cat ~/.port-daddy/daemon.port 2>/dev/null | sed 's#^#http://127.0.0.1:#')}"  # Use pd status if yours differs

SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=%s)
AUTHOR=$(git log -1 --pretty=%an)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | head -20 | tr '\\n' ', ')

curl -s -X POST "\${PD_URL}/msg/git:committed" \\
  -H 'Content-Type: application/json' \\
  -d "{\\"payload\\": {\\"sha\\": \\"\${SHA}\\", \\"message\\": \\"\${MSG}\\"}}" \\
  --connect-timeout 2 --max-time 3 \\
  >/dev/null 2>&1 &

# Expected result: git commit returns immediately and the daemon records one git:committed message.
exit 0`}</CodeBlock>

          <motion.p>
            Save this to <code>.git/hooks/post-commit</code> and run{" "}
            <code>chmod +x</code> on it. The <code>curl</code> runs in the
            background &mdash; your commit completes instantly. The fleet wakes
            up behind the scenes.
          </motion.p>

          <Surface depth="raised" radius="none" className="p-6 space-y-3">
            <motion.p className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0 text-[var(--brand-accent)]">
              What happens next?
            </motion.p>
            <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
              You commit. The hook publishes to <code>git:committed</code>. Port
              Daddy delivers the message to every agent with that trigger. Each
              agent spawns, does its job, and publishes its result. The whole
              thing takes seconds to start, and you never had to think about it.
            </motion.p>
          </Surface>
        </section>

        {/* Step 3: Triggers vs Schedules */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Clock className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">3. Triggers vs. Schedules</motion.h2>
          </motion.div>

          <motion.div className="grid sm:grid-cols-2 gap-8">
            <Surface depth="raised" radius="none" className="p-8 space-y-4">
              <Surface
                depth="flat"
                radius="none"
                padding="none"
                className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
              >
                <Zap size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-[length:var(--type-panel-title-nav-size)] font-display font-black m-0">
                Triggered Agents
              </motion.h3>
              <motion.p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
                Fire when a message arrives on their channel. Reactive. Good for
                code review, docs updates, test coverage. Think event handlers.
              </motion.p>
              <CodeBlock copyable={false} language="yaml">{`qa:
  trigger: git:committed
  backend: cloudflare
  model: '@cf/qwen/qwen3-30b-a3b-fp8'`}</CodeBlock>
            </Surface>
            <Surface depth="raised" radius="none" className="p-8 space-y-4">
              <Surface
                depth="flat"
                radius="none"
                padding="none"
                className="w-10 h-10 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
              >
                <Clock size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-[length:var(--type-panel-title-nav-size)] font-display font-black m-0">
                Scheduled Agents
              </motion.h3>
              <motion.p className="text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)] m-0">
                Run on a cron interval. Steady. Good for health checks, idea
                generation, cleanup. Think cron jobs with brains.
              </motion.p>
              <CodeBlock copyable={false} language="yaml">{`gardener:
  schedule: "*/10 * * * *"
  backend: custom`}</CodeBlock>
            </Surface>
          </motion.div>

          <motion.p>
            An agent can have both. Spider runs every 2 hours <em>and</em>{" "}
            triggers when Spark publishes an idea.
          </motion.p>
        </section>

        {/* Step 4: Agent Dialogue */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Radio className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">
              4. Agents That Talk to Each Other
            </motion.h2>
          </motion.div>

          <motion.p>
            The useful part: one agent&apos;s output becomes another
            agent&apos;s trigger.
          </motion.p>

          <Surface depth="raised" radius="none" className="p-8 space-y-4">
            <motion.p className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0">
              The Spark &amp; Spider Loop
            </motion.p>
            <motion.div className="space-y-3 pt-2">
              <motion.div className="flex items-center gap-3 text-[length:var(--type-meta-size)] text-[var(--text-secondary)]">
                <Badge variant="gold">Spark</Badge>
                <span>proposes an idea every 30 min</span>
                <ArrowRight size={14} className="flex-shrink-0" />
                <code>spark:idea</code>
              </motion.div>
              <motion.div className="flex items-center gap-3 text-[length:var(--type-meta-size)] text-[var(--text-secondary)]">
                <Badge variant="default">Spider</Badge>
                <span>triggers on that idea, finds connections</span>
                <ArrowRight size={14} className="flex-shrink-0" />
                <code>spider:connections</code>
              </motion.div>
              <motion.div className="flex items-center gap-3 text-[length:var(--type-meta-size)] text-[var(--text-secondary)]">
                <Badge variant="gold">Spark</Badge>
                <span>reads Spider&apos;s files on next run</span>
                <ArrowRight size={14} className="flex-shrink-0" />
                <span>proposes implementations</span>
              </motion.div>
            </motion.div>
          </Surface>

          <motion.p>
            Notice the asymmetry: Spider <em>triggers</em> on Spark&apos;s
            channel, but Spark only <em>reads</em> Spider&apos;s output files.
            This prevents infinite loops. Port Daddy validates your trigger
            graph is a DAG before any agent starts.
          </motion.p>
        </section>

        {/* Step 5: Monitoring */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Eye className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">5. See What They Did</motion.h2>
          </motion.div>

          <CodeBlock copyable={false} language="bash">{`pd fleet up       # Start the fleet
pd fleet status   # What's running?
pd fleet down     # Stop everything
# Expected result: status lists configured agents, readiness, and whether the fleet is running.`}</CodeBlock>

          <motion.p>
            Open the Fleet Control Center or the daemon-served dashboard at{" "}
            <code>/fleet-ui/</code>. It carries Flow, Activity, Channels, Inbox,
            and Spawned Runs in one shell instead of splitting status across older
            one-off pages.
          </motion.p>

          <Surface depth="raised" radius="none" className="p-6 space-y-3">
            <motion.p className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0 text-[var(--brand-accent)]">
              Menu Bar App
            </motion.p>
            <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
              Build the native macOS menu bar app from{" "}
              <code>apps/FleetBar</code>. One click in your menu bar opens the
              Fleet Control Center shell around the same daemon-backed
              dashboard.
            </motion.p>
          </Surface>
        </section>

        {/* Step 6: Safety */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface
              depth="flat"
              radius="none"
              padding="none"
              className="w-12 h-12 flex items-center justify-center border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]"
            >
              <Shield className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">6. Guardrails</motion.h2>
          </motion.div>

          <motion.div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="raised" radius="none" className="p-6 space-y-3">
              <motion.h3 className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0">
                DAG Validation
              </motion.h3>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                Trigger graph checked for cycles before any agent starts. Loops
                are caught at config time, not runtime.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="none" className="p-6 space-y-3">
              <motion.h3 className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0">
                Singletons
              </motion.h3>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                <code>singleton: true</code> ensures only one instance runs at a
                time. No runaway duplicates.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="none" className="p-6 space-y-3">
              <motion.h3 className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0">
                Scoped Tools
              </motion.h3>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                <code>allowedTools</code> limits what each agent can do.
                Read-only agents can&apos;t write. No ambient authority.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="none" className="p-6 space-y-3">
              <motion.h3 className="text-[length:var(--type-panel-body-compact-size)] font-bold m-0">
                Immutable Notes
              </motion.h3>
              <motion.p className="text-[length:var(--type-meta-size)] text-[var(--text-secondary)] m-0">
                Every agent writes session notes that cannot be edited or
                deleted. Evidence survives misbehavior.
              </motion.p>
            </Surface>
          </motion.div>
        </section>

        {/* Quick Start */}
        <section className="space-y-6">
          <Surface depth="raised" radius="none" className="p-8 space-y-4">
            <motion.h3 className="text-[length:var(--type-panel-title-nav-size)] font-display font-black m-0">
              Quick Start
            </motion.h3>
            <motion.ol className="space-y-2 text-[length:var(--type-panel-body-compact-size)] text-[var(--text-secondary)]">
              <motion.li>
                Create <code>pd-fleet.yml</code> at your project root
              </motion.li>
              <motion.li>
                Add a post-commit hook that publishes to{" "}
                <code>git:committed</code>
              </motion.li>
              <motion.li>
                Run <code>pd fleet up</code>
              </motion.li>
              <motion.li>Commit something. Watch the agents fire.</motion.li>
              <motion.li>
                Open the Fleet Control Center or <code>/fleet-ui/</code> to see
                what they did
              </motion.li>
            </motion.ol>
          </Surface>
        </section>
      </motion.div>
    </TutorialLayout>
  );
}
