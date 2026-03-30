import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import {
  Bot,
  Zap,
  GitCommit,
  Timer,
  MessageSquare,
  Anchor,
  Monitor,
  Shield,
  ArrowDown,
  ArrowRight,
  FileText,
  Clock,
  Network,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'

export function Fleet() {
  return (
    <TutorialLayout
      title="Background Fleet Agents"
      description="Declare a team of AI agents in YAML. They trigger on commits, run on schedules, and talk to each other through Swarm Radio -- all while you sleep."
      number={17}
      total={17}
      level="Intermediate"
      readTime="12 min read"
      prev={{ title: 'The Session State Machine', href: '/tutorials/session-phases' }}
      next={null}
    >
      <motion.div className="space-y-16">
        {/* Section 1: Intro */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Bot className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Your Agents, Running While You Sleep</motion.h2>
          </motion.div>

          <motion.p>
            You have agents that review commits. Agents that hunt for test gaps. Agents that keep your docs in sync with code. Right now, you launch them by hand. You babysit them. You forget to run them after a late-night commit.
          </motion.p>
          <motion.p>
            The <strong>Fleet</strong> changes that. You write a YAML file that declares your agents -- what they do, when they run, and how they communicate. Port Daddy handles the rest: spawning, scheduling, triggering, and monitoring. One file. Zero babysitting.
          </motion.p>

          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
            <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
              <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 mx-auto flex items-center justify-center">
                <FileText size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-sm font-display font-black m-0">Declared, Not Coded</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">Agents live in a YAML file. No shell scripts to maintain.</motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
              <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 mx-auto flex items-center justify-center">
                <Zap size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-sm font-display font-black m-0">Event-Driven</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">Agents trigger on commits, timers, or other agents' output.</motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
              <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 mx-auto flex items-center justify-center">
                <Monitor size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-sm font-display font-black m-0">Observable</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">Fleet Live dashboard shows every agent's status in real time.</motion.p>
            </Surface>
          </motion.div>
        </section>

        {/* Section 2: Writing Your Fleet YAML */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <FileText className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Writing Your Fleet YAML</motion.h2>
          </motion.div>

          <motion.p>
            Create a <code>pd-fleet.yml</code> in your project root. This is the single source of truth for your background agents. Here is a real example -- this is the fleet that helps develop Port Daddy itself:
          </motion.p>

          <CodeBlock language="yaml">
            {`# pd-fleet.yml — Your background agent team
fleet:
  name: port-daddy-dev
  harbor: "{project}:fleet"

  agents:
    gardener:
      schedule: "*/10 * * * *"
      backend: custom
      prompt: "git status --porcelain"
      on_success: publish git:status
      identity: "{project}:fleet:gardener"

    qa:
      trigger: git:committed
      backend: claude-cli
      allowedTools: "Read,Grep,Glob,Bash(npm test*)"
      prompt: |
        Review the most recent commit. Read every changed file.
        For each change, identify inputs that would break it.
        If you find bugs, write a test that exposes each one.
        If clean, just say CLEAN.
      on_success: publish qa:clean
      on_failure: publish qa:findings
      identity: "{project}:fleet:qa"

    test-hunter:
      trigger: git:committed
      backend: claude-cli
      allowedTools: "Read,Grep,Glob,Write,Bash(npm test*)"
      prompt: |
        Run the test suite. Find modules below 50% coverage.
        For each gap, write meaningful tests that exercise
        real code paths.
      identity: "{project}:fleet:test-hunter"`}
          </CodeBlock>

          <motion.p>
            Every agent has a <code>prompt</code> (what it does), an activation method (<code>trigger</code> or <code>schedule</code>), and a <code>backend</code> (how it runs). The <code>identity</code> field registers the agent in Port Daddy's semantic trie so other agents can discover it.
          </motion.p>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The <code>{'{project}'}</code> placeholder is replaced with your project's registered name at runtime. If your project is <code>my-app</code>, the QA agent's identity becomes <code>my-app:fleet:qa</code>.
            </p>
          </Surface>
        </section>

        {/* Section 3: Wiring Git */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <GitCommit className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Wiring Git</motion.h2>
          </motion.div>

          <motion.p>
            Most fleet agents react to commits. The bridge between <code>git commit</code> and Port Daddy's Swarm Radio is a post-commit hook. When you run <code>pd fleet up</code>, Port Daddy installs this hook automatically. Here is what it does:
          </motion.p>

          <CodeBlock language="bash">
            {`#!/usr/bin/env zsh
# .git/hooks/post-commit — installed by pd fleet up

PD_URL="\${PD_URL:-http://localhost:9876}"

# Gather commit metadata
SHA=$(git rev-parse --short HEAD)
MSG=$(git log -1 --pretty=%s)
AUTHOR=$(git log -1 --pretty=%an)
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | head -20 | tr '\\n' ', ')
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Publish to Swarm Radio (fire-and-forget)
curl -s -X POST "\${PD_URL}/msg/git:committed" \\
  -H 'Content-Type: application/json' \\
  -d "{\\"payload\\": {\\"sha\\": \\"\${SHA}\\", \\"message\\": \\"\${MSG}\\",
       \\"author\\": \\"\${AUTHOR}\\", \\"branch\\": \\"\${BRANCH}\\",
       \\"files\\": \\"\${FILES}\\"}}" \\
  --connect-timeout 2 --max-time 3 >/dev/null 2>&1 &

exit 0`}
          </CodeBlock>

          <motion.p>
            The key detail: <strong>fire-and-forget</strong>. The hook publishes to the <code>git:committed</code> channel and exits immediately. Your commit is never blocked, even if Port Daddy is down. The <code>&amp;</code> at the end of the curl command runs it in the background.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-8 relative overflow-hidden">
            <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-accent)]/5 to-transparent" />
            <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Commit Signal Flow</motion.p>

            <motion.div className="space-y-4">
              <Surface depth="inset" radius="2xl" padding="none" className="p-4 flex items-center justify-between">
                <motion.div className="flex items-center gap-4">
                  <motion.div className="w-2 h-2 rounded-full bg-[var(--brand-secondary)]" />
                  <motion.span className="text-sm font-bold">You run <code>git commit</code></motion.span>
                </motion.div>
                <Badge variant="teal">Trigger</Badge>
              </Surface>
              <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>

              <Surface depth="raised" radius="2xl" className="p-4 flex items-center justify-between">
                <motion.div className="flex items-center gap-4">
                  <GitCommit size={16} className="text-[var(--brand-primary)]" />
                  <motion.span className="text-sm font-bold text-[var(--brand-primary)]">Hook publishes to git:committed</motion.span>
                </motion.div>
                <Badge variant="gold">Swarm Radio</Badge>
              </Surface>
              <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>

              <Surface depth="inset" radius="2xl" padding="none" className="p-4 flex items-center justify-between">
                <motion.div className="flex items-center gap-4">
                  <Bot size={16} className="text-[var(--brand-accent)]" />
                  <motion.span className="text-sm font-bold">QA, Test Hunter, Documentarian, Simplifier, Cartographer all wake up</motion.span>
                </motion.div>
                <Badge variant="default">Fan-Out</Badge>
              </Surface>
            </motion.div>
          </Surface>
        </section>

        {/* Section 4: Triggers vs Schedules */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Timer className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">3. Triggers vs. Schedules</motion.h2>
          </motion.div>

          <motion.p>
            Fleet agents activate in two ways. Understanding the difference is the key to designing a fleet that does not waste resources or miss events.
          </motion.p>

          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
            <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
              <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                <Zap size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-xl font-display font-black m-0">Trigger</motion.h3>
              <motion.p className="text-sm text-[var(--text-secondary)] m-0">
                Runs when a message arrives on a Swarm Radio channel. Reactive -- the agent sleeps until poked.
              </motion.p>
              <CodeBlock language="yaml">
                {`qa:
  trigger: git:committed
  # Wakes up every time someone commits`}
              </CodeBlock>
            </Surface>

            <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
              <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                <Clock size={20} className="text-[var(--brand-secondary)]" />
              </Surface>
              <motion.h3 className="text-xl font-display font-black m-0">Schedule</motion.h3>
              <motion.p className="text-sm text-[var(--text-secondary)] m-0">
                Runs on a cron expression. Proactive -- the agent wakes itself up on a timer.
              </motion.p>
              <CodeBlock language="yaml">
                {`gardener:
  schedule: "*/10 * * * *"
  # Runs every 10 minutes, rain or shine`}
              </CodeBlock>
            </Surface>
          </motion.div>

          <motion.p>
            An agent can have <strong>both</strong>. Spider runs every 2 hours on a schedule, but it also triggers immediately when Spark publishes a new idea:
          </motion.p>

          <CodeBlock language="yaml">
            {`spider:
  trigger: spark:idea        # React to Spark's output
  schedule: "0 */2 * * *"   # Also run every 2 hours independently
  singleton: true            # Never run two Spiders at once`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-accent)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The <code>singleton: true</code> flag prevents duplicate runs. If Spider is already running when a trigger fires, the trigger is queued until the current run finishes.
            </p>
          </Surface>
        </section>

        {/* Section 5: Agent Dialogue — Spark and Spider */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <MessageSquare className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">4. Agent Dialogue: Spark and Spider</motion.h2>
          </motion.div>

          <motion.p>
            The most interesting pattern in a fleet is when agents talk to each other. Port Daddy's own fleet has two creative agents -- <strong>Spark</strong> (the idea engine) and <strong>Spider</strong> (the connection engine) -- that form an asymmetric dialogue.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-8 relative overflow-hidden">
            <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent" />
            <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Spark-Spider Dialogue</motion.p>

            <motion.div className="space-y-6">
              {/* Spark produces */}
              <motion.div className="flex items-start gap-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-8 h-8 flex-shrink-0 flex items-center justify-center mt-1">
                  <Zap size={14} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.div className="flex-1 space-y-1">
                  <motion.span className="text-xs font-black uppercase tracking-widest text-[var(--brand-secondary)]">Spark</motion.span>
                  <motion.p className="text-sm m-0">Reads the roadmap and recent commits. Proposes an idea. Saves it to <code>.spark/ideas/</code>.</motion.p>
                </motion.div>
                <Badge variant="gold">Every 30 min</Badge>
              </motion.div>

              <motion.div className="flex justify-center">
                <motion.div className="flex items-center gap-2 text-[var(--brand-primary)]">
                  <ArrowDown size={16} className="opacity-40" />
                  <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-40">publishes spark:idea</motion.span>
                </motion.div>
              </motion.div>

              {/* Spider reacts */}
              <motion.div className="flex items-start gap-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-8 h-8 flex-shrink-0 flex items-center justify-center mt-1">
                  <Network size={14} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.div className="flex-1 space-y-1">
                  <motion.span className="text-xs font-black uppercase tracking-widest text-[var(--brand-accent)]">Spider</motion.span>
                  <motion.p className="text-sm m-0">Reads Spark's idea. Cross-references the feature manifest. Produces syllogisms -- formal connections between existing features. Saves to <code>.spider/connections/</code>.</motion.p>
                </motion.div>
                <Badge variant="teal">Triggered</Badge>
              </motion.div>

              <motion.div className="flex justify-center">
                <motion.div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <ArrowDown size={16} className="opacity-40" style={{ transform: 'rotate(180deg)' }} />
                  <motion.span className="text-[10px] font-black uppercase tracking-widest opacity-40">reads .spider/connections/ (file system)</motion.span>
                </motion.div>
              </motion.div>

              {/* Spark reads back */}
              <motion.div className="flex items-start gap-4 opacity-60">
                <Surface depth="inset" radius="xl" padding="none" className="w-8 h-8 flex-shrink-0 flex items-center justify-center mt-1">
                  <Zap size={14} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.div className="flex-1 space-y-1">
                  <motion.span className="text-xs font-black uppercase tracking-widest text-[var(--brand-secondary)]">Spark (next run)</motion.span>
                  <motion.p className="text-sm m-0">Reads Spider's connections. If a connection is worth building, proposes the concrete implementation. The cycle continues.</motion.p>
                </motion.div>
                <Badge variant="default">Loop</Badge>
              </motion.div>
            </motion.div>
          </Surface>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-primary)]">
            <motion.div className="space-y-2">
              <motion.p className="m-0 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Why the asymmetry?
              </motion.p>
              <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                The forward path (Spark to Spider) uses a Swarm Radio channel -- an instant trigger. The backward path (Spider to Spark) uses the file system -- Spark reads at its own pace on its next scheduled run. This avoids deadlock. If both directions used channels, the agents could block each other. The file system acts as an unbounded buffer for the backward direction.
              </p>
            </motion.div>
          </Surface>
        </section>

        {/* Section 6: Fleet Harbors */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Anchor className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">5. Fleet Harbors</motion.h2>
          </motion.div>

          <motion.p>
            Every fleet declares a <strong>harbor</strong> -- a shared semantic namespace that groups all its agents under one identity. This is defined at the top of your fleet YAML:
          </motion.p>

          <CodeBlock language="yaml">
            {`fleet:
  name: port-daddy-dev
  harbor: "{project}:fleet"   # All agents share this harbor`}
          </CodeBlock>

          <motion.p>
            When <code>pd fleet up</code> starts, it creates the harbor and enrolls every agent as a member. This gives you three things:
          </motion.p>

          <motion.div className="grid sm:grid-cols-3 gap-6">
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Scoped Discovery</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                Query the semantic trie with <code>port-daddy:fleet:*</code> to find all fleet agents at once.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Collective Identity</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                The harbor is the fleet's identity in the broader system. Other projects see one fleet, not eight separate agents.
              </motion.p>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <motion.h3 className="text-sm font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Scoped Messaging</motion.h3>
              <motion.p className="text-xs text-[var(--text-secondary)] m-0">
                Harbor members can subscribe to harbor-scoped channels, keeping fleet chatter isolated from the rest of Swarm Radio.
              </motion.p>
            </Surface>
          </motion.div>

          <CodeBlock language="bash">
            {`# See all agents in the fleet harbor
$ pd harbors port-daddy:fleet members
AGENT                              STATUS     LAST HEARTBEAT
port-daddy:fleet:gardener          active     12s ago
port-daddy:fleet:qa                idle       2m ago
port-daddy:fleet:test-hunter       idle       2m ago
port-daddy:fleet:documentarian     running    45s ago
port-daddy:fleet:simplifier        idle       2m ago
port-daddy:fleet:cartographer      idle       2m ago
port-daddy:fleet:spark             idle       8m ago
port-daddy:fleet:spider            idle       1h ago`}
          </CodeBlock>
        </section>

        {/* Section 7: Monitoring */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Monitor className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">6. Monitoring Your Fleet</motion.h2>
          </motion.div>

          <motion.p>
            Once the fleet is running, you have two ways to observe it: the CLI and the Fleet Live dashboard.
          </motion.p>

          <CodeBlock language="bash">
            {`# Start the fleet
$ pd fleet up
Fleet "port-daddy-dev" started — 8 agents, 1 watcher
Harbor: port-daddy:fleet
Post-commit hook: installed

# Check fleet status
$ pd fleet status
AGENT           TRIGGER          LAST RUN       STATUS    RUNS
gardener        */10 * * * *     2m ago         idle      47
qa              git:committed    12m ago        idle      5
test-hunter     git:committed    12m ago        idle      5
documentarian   git:committed    12m ago        running   5
simplifier      git:committed    12m ago        idle      5
cartographer    git:committed    12m ago        idle      5
spark           */30 * * * *     18m ago        idle      12
spider          spark:idea       22m ago        idle      8

# Watch fleet output in real time
$ pd fleet live
[gardener]      git status --porcelain: 3 files modified
[qa]            CLEAN — all 4 changed files reviewed
[test-hunter]   Added 3 tests for lib/pheromone.ts (was 42% coverage)
[documentarian] Updated CLAUDE.md API table: +2 endpoints`}
          </CodeBlock>

          <motion.p>
            The <code>pd fleet live</code> command streams agent output as it happens. It is a filtered view of Swarm Radio, showing only messages from agents in your fleet's harbor.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
            <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-accent)]/5 to-transparent" />
            <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Fleet Dashboard Panel</motion.p>
            <motion.div className="space-y-4">
              <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4">
                <motion.div className="flex items-center gap-4">
                  <CheckCircle2 size={16} className="text-green-500" />
                  <motion.span className="text-sm font-bold">qa -- CLEAN (5 runs, 0 findings)</motion.span>
                </motion.div>
                <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">12m ago</motion.span>
              </Surface>
              <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4">
                <motion.div className="flex items-center gap-4">
                  <Zap size={16} className="text-[var(--brand-secondary)] animate-pulse" />
                  <motion.span className="text-sm font-bold">documentarian -- updating CLAUDE.md</motion.span>
                </motion.div>
                <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">running</motion.span>
              </Surface>
              <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4 opacity-50">
                <motion.div className="flex items-center gap-4">
                  <Clock size={16} />
                  <motion.span className="text-sm font-bold">spark -- next run in 12 min</motion.span>
                </motion.div>
                <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">idle</motion.span>
              </Surface>
            </motion.div>
          </Surface>
        </section>

        {/* Section 8: Topology Validation */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Network className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">7. Topology Validation</motion.h2>
          </motion.div>

          <motion.p>
            A fleet's trigger graph must be a <strong>directed acyclic graph</strong> (DAG). If Agent A triggers Agent B, and Agent B triggers Agent A through channels, you have a cycle -- and cycles mean infinite loops. Port Daddy validates this when the fleet starts.
          </motion.p>

          <CodeBlock language="bash">
            {`# pd fleet up validates the trigger graph automatically
$ pd fleet up
Validating trigger topology...
  git:committed -> [qa, test-hunter, documentarian, simplifier, cartographer]
  spark:idea    -> [spider]
  qa:findings   -> [notify-findings]
Topology: DAG verified (0 cycles)
Fleet "port-daddy-dev" started — 8 agents, 1 watcher`}
          </CodeBlock>

          <motion.p>
            If you accidentally create a cycle, the fleet refuses to start:
          </motion.p>

          <CodeBlock language="bash">
            {`# A broken fleet with a trigger cycle
$ pd fleet up
Validating trigger topology...
  ERROR: Cycle detected: agent-a -> channel:x -> agent-b -> channel:y -> agent-a
  Fleet NOT started. Fix the cycle in pd-fleet.yml.`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-accent)]">
            <motion.div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-[var(--brand-accent)] flex-shrink-0 mt-0.5" />
              <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
                File-based communication (like Spark reading Spider's output from <code>.spider/connections/</code>) does <strong>not</strong> count as a trigger edge. Only Swarm Radio channel triggers are checked. This is why the Spark-Spider dialogue works -- the backward path through the file system breaks what would otherwise be a cycle.
              </p>
            </motion.div>
          </Surface>

          {/* Topology diagram */}
          <Surface depth="raised" radius="2xl" className="p-10 space-y-8 relative overflow-hidden">
            <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent" />
            <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Port Daddy Fleet Topology</motion.p>

            <motion.div className="space-y-6">
              {/* Scheduled agents */}
              <motion.div className="flex flex-col sm:flex-row items-center gap-4">
                <Surface depth="inset" radius="xl" padding="none" className="px-4 py-2 flex items-center gap-2">
                  <Clock size={14} className="text-[var(--brand-secondary)]" />
                  <motion.span className="text-xs font-bold">Gardener (*/10m)</motion.span>
                </Surface>
                <ArrowRight size={14} className="opacity-30 hidden sm:block" />
                <ArrowDown size={14} className="opacity-30 sm:hidden" />
                <Badge variant="default">git:status</Badge>
              </motion.div>

              {/* Commit fan-out */}
              <motion.div className="flex flex-col items-center gap-4">
                <Badge variant="gold">git:committed</Badge>
                <motion.div className="flex flex-wrap justify-center gap-3">
                  {['QA', 'Test Hunter', 'Documentarian', 'Simplifier', 'Cartographer'].map(name => (
                    <Surface key={name} depth="inset" radius="xl" padding="none" className="px-3 py-1.5">
                      <motion.span className="text-xs font-bold">{name}</motion.span>
                    </Surface>
                  ))}
                </motion.div>
              </motion.div>

              {/* QA escalation */}
              <motion.div className="flex flex-col sm:flex-row items-center gap-4">
                <Surface depth="inset" radius="xl" padding="none" className="px-4 py-2">
                  <motion.span className="text-xs font-bold">QA (on failure)</motion.span>
                </Surface>
                <ArrowRight size={14} className="opacity-30 hidden sm:block" />
                <ArrowDown size={14} className="opacity-30 sm:hidden" />
                <Badge variant="red">qa:findings</Badge>
                <ArrowRight size={14} className="opacity-30 hidden sm:block" />
                <ArrowDown size={14} className="opacity-30 sm:hidden" />
                <Surface depth="inset" radius="xl" padding="none" className="px-4 py-2">
                  <motion.span className="text-xs font-bold">Notify Watcher</motion.span>
                </Surface>
              </motion.div>

              {/* Spark-Spider chain */}
              <motion.div className="flex flex-col sm:flex-row items-center gap-4">
                <Surface depth="inset" radius="xl" padding="none" className="px-4 py-2 flex items-center gap-2">
                  <Clock size={14} className="text-[var(--brand-secondary)]" />
                  <motion.span className="text-xs font-bold">Spark (*/30m)</motion.span>
                </Surface>
                <ArrowRight size={14} className="opacity-30 hidden sm:block" />
                <ArrowDown size={14} className="opacity-30 sm:hidden" />
                <Badge variant="teal">spark:idea</Badge>
                <ArrowRight size={14} className="opacity-30 hidden sm:block" />
                <ArrowDown size={14} className="opacity-30 sm:hidden" />
                <Surface depth="inset" radius="xl" padding="none" className="px-4 py-2 flex items-center gap-2">
                  <Clock size={14} className="text-[var(--brand-secondary)]" />
                  <motion.span className="text-xs font-bold">Spider (*/2h)</motion.span>
                </Surface>
              </motion.div>
            </motion.div>
          </Surface>
        </section>

        {/* Quick Start */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Quick Start</motion.h2>
          </motion.div>

          <motion.p>
            To get a fleet running in your project, you need three things: a YAML file, a running daemon, and one command.
          </motion.p>

          <CodeBlock language="bash">
            {`# 1. Make sure the daemon is running
$ pd status
Port Daddy daemon: running (pid 12345)

# 2. Create pd-fleet.yml in your project root
#    (copy the example from Section 1 and customize)

# 3. Start the fleet
$ pd fleet up

# 4. Commit something and watch the agents react
$ git commit -m "feat: add user avatars"
# → QA, test-hunter, documentarian, simplifier, cartographer all activate

# 5. Stop the fleet when you're done
$ pd fleet down`}
          </CodeBlock>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
          <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
            <Bot size={400} />
          </motion.div>
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Development</Badge>
          <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>
            Agents That Compound.
          </motion.h3>
          <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
            A fleet is not a script runner. It is a <strong>communicating process network</strong> where each agent's output can trigger the next. Spark proposes. Spider connects. QA verifies. Documentarian records. The more agents you add, the more value each individual agent produces.
          </motion.p>
          <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
            <Shield size={14} className="animate-pulse" />
            DAG-Verified Process Network
          </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
