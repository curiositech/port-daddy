import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Terminal, Users, FileCode, Activity, AlertTriangle } from 'lucide-react'

export function GettingStarted() {
  return (
    <TutorialLayout
      title="Getting Started"
      description="Install Port Daddy, start the daemon, and see how two AI agents coordinate on the same project without stepping on each other."
      number={1}
      total={16}
      level="Beginner"
      readTime="10 min read"
      next={{ title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent' }}
    >
      <motion.div className="space-y-16">
        {/* What is Port Daddy */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Users className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">What is Port Daddy?</motion.h2>
          </motion.div>
          <motion.p>
            A single AI agent working on your project is straightforward. It has exclusive access to everything and cannot conflict with anyone. The moment you add a second agent, everything breaks: they fight over ports, overwrite each other's files, and have no way to communicate state changes. This is the <strong>Second Agent Problem</strong>.
          </motion.p>
          <motion.p>
            Port Daddy is a local daemon that solves this. It runs on <code>localhost:9876</code> and provides the low-level coordination primitives that your agents need: <strong>port assignment</strong> so services never collide, <strong>file claims</strong> so agents know who is working on what, <strong>pub/sub messaging</strong> so agents can signal each other, and <strong>session notes</strong> so context survives agent crashes.
          </motion.p>
          <motion.p>
            Port Daddy is not a high-level orchestration framework like CrewAI or LangGraph. It is the coordination kernel that sits underneath whatever agent framework you use. Think of it as the operating system for your agent swarm.
          </motion.p>
        </section>

        {/* Installation */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Terminal className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Install</motion.h2>
          </motion.div>

          <motion.div className="grid sm:grid-cols-2 gap-6">
            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <Badge variant="teal">macOS / Linux</Badge>
              <CodeBlock language="bash">
                {`brew tap erichowens/port-daddy\nbrew install port-daddy`}
              </CodeBlock>
            </motion.div>
            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <Badge variant="neutral">Node.js / Global</Badge>
              <CodeBlock language="bash">
                {`npm install -g port-daddy`}
              </CodeBlock>
            </motion.div>
          </motion.div>

          <motion.div className="bg-[var(--bg-overlay)] p-10 rounded-[40px] border border-[var(--border-subtle)] space-y-6">
            <motion.p className="text-sm uppercase tracking-widest font-black mb-2 text-[var(--text-muted)]">Start the daemon</motion.p>
            <CodeBlock language="bash">{`pd start`}</CodeBlock>
            <motion.p className="mt-4 mb-0 text-sm text-[var(--text-secondary)]">
              The daemon is now listening on <code>localhost:9876</code>. Verify with <code>pd status</code>.
            </motion.p>
          </motion.div>

          <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-teal-500)]">
            <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-4 text-2xl font-display">Make it permanent with pd install</motion.p>
            <motion.p className="m-0 text-lg">
              Running <code>pd install</code> registers Port Daddy as a <strong>launchd service</strong> on macOS (or a systemd unit on Linux). The daemon will start automatically on login and restart if it crashes. This is the recommended setup for any machine where you run agents regularly. You never have to think about starting the daemon again.
            </motion.p>
            <CodeBlock language="bash">{`pd install\n# Daemon now auto-starts on login. Verify:\nlaunchctl list | grep portdaddy`}</CodeBlock>
          </blockquote>
        </section>

        {/* Your First Claim */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Activity className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Your First Claim</motion.h2>
          </motion.div>

          <motion.p>
            Port Daddy uses <strong>semantic identities</strong> instead of port numbers. Instead of remembering that your API runs on port 3102 and your frontend on 5173, you give each service a name in the format <code>project:stack:context</code>. Port Daddy assigns and tracks the ports for you.
          </motion.p>

          <CodeBlock language="bash">
            {`# Claim a port for your API service
$ pd claim my-app:api:main
→ Port 10234 assigned to my-app:api:main

# Claim another for the frontend
$ pd claim my-app:frontend:main
→ Port 10235 assigned to my-app:frontend:main

# Look up any service by name
$ pd find my-app:api:main
→ 10234`}
          </CodeBlock>

          <motion.p>
            Claims are <strong>idempotent</strong>. If you claim the same identity again, you get the same port back. If a service crashes and restarts, it reclaims its identity and gets the same port. Other services that depend on it never need to update their configuration.
          </motion.p>
        </section>

        {/* The Real Scenario: Two Agents */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Users className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">3. Two Agents, One Project</motion.h2>
          </motion.div>

          <motion.p>
            Here is where Port Daddy earns its keep. You have two AI agents working on the same codebase. Agent Alpha is refactoring middleware. Agent Beta is adding rate limiting. Without coordination, they will overwrite each other's changes, run conflicting tests, and waste hours of compute.
          </motion.p>

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[40px] border border-[var(--border-subtle)] space-y-6 shadow-2xl">
            <motion.div className="flex items-center justify-between">
              <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">Live Example: Two Agents on One Project</motion.span>
              <Badge variant="teal">Active Coordination</Badge>
            </motion.div>
            <motion.div className="space-y-4">
              <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--p-teal-500)]/20">
                <motion.div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)]" />
                <motion.span className="text-sm font-bold text-[var(--text-primary)]">Agent Alpha claiming src/middleware/</motion.span>
              </motion.div>
              <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-transparent">
                <motion.div className="w-2 h-2 rounded-full bg-[var(--status-success)]" />
                <motion.span className="text-sm font-bold text-[var(--text-secondary)]">Agent Beta watching for middleware-ready signal...</motion.span>
              </motion.div>
            </motion.div>
          </motion.div>

          <motion.h3>Step A: Start sessions and claim files</motion.h3>
          <motion.p>
            Each agent begins by starting a session with <code>pd begin</code> and claiming the files it plans to modify. File claims are <strong>advisory</strong>, not hard locks. They tell the daemon "I intend to work on these files" so other agents get warned about potential conflicts.
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent Alpha starts a session and claims files
$ pd begin --identity my-app:refactor --purpose "Refactor middleware"
$ pd files claim src/middleware/*.ts src/routes/auth.ts

Claimed 12 files.
No conflicts with other active agents.`}
          </CodeBlock>

          <CodeBlock language="bash">
            {`# Agent Beta tries to work on overlapping files
$ pd begin --identity my-app:api --purpose "Add rate limiting"
$ pd files claim src/middleware/rateLimit.ts

WARNING: CONFLICT
  src/middleware/rateLimit.ts is claimed by my-app:refactor
  Session: abc123 | Purpose: "Refactor middleware"

  Claim registered anyway (advisory).
  Consider coordinating with my-app:refactor.`}
          </CodeBlock>

          <motion.p>
            Notice that Port Daddy still allows Beta to register its claim. The warning is the valuable part: Beta now knows another agent is working on the same file and can decide to wait, work on something else, or coordinate via pub/sub.
          </motion.p>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-amber-400)]">
            <motion.p className="m-0 text-base font-medium text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Why advisory instead of mandatory?</strong> Hard locks sound safer, but they create deadlocks. If Agent Alpha locks a file and then crashes, the file stays locked until someone manually releases it. Advisory claims plus crash recovery (salvage) give you the coordination benefit without the deadlock risk.
            </motion.p>
          </blockquote>

          <motion.h3>Step B: Signal when done</motion.h3>
          <motion.p>
            When Agent Alpha finishes its work, it publishes a message. Agent Beta can watch for that signal and react automatically. No polling, no cron jobs, no manual handoffs.
          </motion.p>

          <CodeBlock language="bash">
            {`# Agent Alpha finishes and signals
$ pd pub swarm:events "middleware-updated"

# Agent Beta was waiting for this
$ pd watch swarm:events --exec "npm test"

  Watching swarm:events...
  Message received: "middleware-updated"
  Running: npm test
  Tests passed (14/14)`}
          </CodeBlock>

          <motion.p>
            The <code>pd watch</code> command subscribes to a channel via Server-Sent Events and runs a command every time a message arrives. The message content is available as environment variables (<code>PD_MESSAGE</code>, <code>PD_CHANNEL</code>, <code>PD_TIMESTAMP</code>) so your scripts can react to specific events.
          </motion.p>

          <motion.h3>Step C: Leave a trail</motion.h3>
          <motion.p>
            As agents work, they should write notes explaining what they are doing and why. Notes are <strong>immutable</strong> -- appended to the session log and never edited or deleted. When an agent crashes and a new agent picks up the work, the notes are its primary source of context.
          </motion.p>

          <CodeBlock language="bash">
            {`# Document decisions as you go
$ pd note "Refactoring auth middleware to use JWT instead of sessions"
$ pd note "Changed token shape -- consumers need to update" --type warning
$ pd note "Auth middleware refactor complete, 3 files changed" --type milestone

# Read recent notes from any agent
$ pd notes --limit 5

[milestone] Auth middleware refactor complete, 3 files changed    2m ago
[warning]   Changed token shape -- consumers need to update        5m ago
[progress]  Refactoring auth middleware to use JWT                 8m ago`}
          </CodeBlock>

          <motion.h3>Step D: Clean up</motion.h3>
          <motion.p>
            When an agent finishes, it calls <code>pd done</code> to end its session. This releases file claims, marks the session as complete, and writes a final summary note. Skipping this step leaves stale claims that confuse the next agent.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd done --summary "Middleware refactored to JWT. All tests passing."`}
          </CodeBlock>
        </section>

        {/* The Pattern */}
        <section className="space-y-8">
          <motion.div
            className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          >
            <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">The Pattern</Badge>
            <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Begin. Claim. Work. Signal. Done.</motion.h3>
            <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
              Every agent follows the same lifecycle: start a session (<code>pd begin</code>), claim files, do the work while writing notes, signal completion via pub/sub, and end the session (<code>pd done</code>). Port Daddy handles the coordination so your agents can focus on the task.
            </motion.p>
          </motion.div>
        </section>

        {/* Common Mistakes */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <AlertTriangle className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Common Mistakes</motion.h2>
          </motion.div>

          <motion.div className="space-y-6">
            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Not running pd install</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If you only use <code>pd start</code>, the daemon dies when you close the terminal or reboot. Run <code>pd install</code> once to register it as a system service. Your agents will thank you at 3 AM when the daemon is still running.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Skipping pd begin</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If you skip <code>pd begin</code>, your file claims and notes are not attached to a session. They still work, but they cannot be salvaged if the agent crashes. Always start with <code>pd begin</code>.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Too-broad file claims</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                Claiming <code>src/**/*</code> defeats the purpose. Claim specific directories or files that you actually intend to modify. The narrower the claim, the more useful the conflict warnings.
              </motion.p>
            </motion.div>

            <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-lg">Not running pd done</motion.p>
              <motion.p className="text-base m-0 text-[var(--text-secondary)] leading-relaxed">
                If you skip <code>pd done</code>, your session stays active and your file claims remain registered. The next agent will see stale conflict warnings. Always clean up when finished.
              </motion.p>
            </motion.div>
          </motion.div>
        </section>

        {/* What's Next */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <FileCode className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">What's Next</motion.h2>
          </motion.div>

          <motion.p>
            You now know the core loop: install, begin, claim, work, signal, done. The next tutorials go deeper into each primitive:
          </motion.p>

          <motion.div className="grid gap-4">
            <motion.div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.div className="w-10 h-10 rounded-full bg-[var(--p-teal-500)]/10 flex items-center justify-center text-[var(--p-teal-400)] font-black text-sm">02</motion.div>
              <motion.div className="flex-1">
                <motion.p className="font-bold m-0 text-lg">Multi-Agent Orchestration</motion.p>
                <motion.p className="text-sm m-0 text-[var(--text-secondary)]">Advanced patterns: reactive pipelines, lock strategies, crash recovery with salvage.</motion.p>
              </motion.div>
            </motion.div>
            <motion.div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.div className="w-10 h-10 rounded-full bg-[var(--p-amber-500)]/10 flex items-center justify-center text-[var(--p-amber-400)] font-black text-sm">03</motion.div>
              <motion.div className="flex-1">
                <motion.p className="font-bold m-0 text-lg">Secure Harbors</motion.p>
                <motion.p className="text-sm m-0 text-[var(--text-secondary)]">Cryptographic permission boundaries and HMAC-signed tokens for your swarms.</motion.p>
              </motion.div>
            </motion.div>
            <motion.div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <motion.div className="w-10 h-10 rounded-full bg-[var(--p-blue-500)]/10 flex items-center justify-center text-[var(--p-blue-400)] font-black text-sm">06</motion.div>
              <motion.div className="flex-1">
                <motion.p className="font-bold m-0 text-lg">DNS Resolver</motion.p>
                <motion.p className="text-sm m-0 text-[var(--text-secondary)]">Give your services human-readable hostnames that resolve instantly across the swarm.</motion.p>
              </motion.div>
            </motion.div>
          </motion.div>
        </section>
      </motion.div>
    </TutorialLayout>
  )
}
