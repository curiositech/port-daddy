import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Footer } from '@/components/layout/Footer'
import { ArrowRight, Terminal, Shield, Radio, History, Anchor, Users } from 'lucide-react'


const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true as const },
  transition: { duration: 0.6 },
}

export function AboutPage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--surface-base)] flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-[var(--brand-primary-foreground)]"
    >
      {/* Hero */}
      <motion.section
        className="py-24 px-6 sm:px-8 lg:px-10 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] relative overflow-hidden"
      >
        <motion.div className="max-w-3xl mx-auto relative z-10 flex flex-col items-center text-center gap-5">
          <Badge
            variant="teal"
            className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]"
          >
            What is Port Daddy?
          </Badge>

          <motion.h1
            className="text-5xl sm:text-7xl font-black tracking-tight font-display leading-[0.95] text-[var(--text-primary)]"
            {...fadeUp}
          >
            The control plane under <br />
            <span className="text-[var(--brand-primary)]">serious coding-agent work.</span>
          </motion.h1>

          <motion.p
            className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-2xl"
            {...fadeUp}
          >
            Port Daddy is a local app and daemon that gives AI coding agents shared state:
            sessions, notes, file ownership, channels, readiness, budgets, and recoverable
            handoffs that survive the terminal that created them.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Main Content - Long-form prose */}
      <motion.main className="flex-1 max-w-3xl mx-auto w-full px-6 sm:px-8 lg:px-10 py-12">
        <article className="space-y-16">

          {/* Section 1: The Problem */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <Users className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                The Problem: No Shared State
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Model capability is improving faster than the local environment around it. Claude Code,
                Codex, Cursor, Gemini CLI, Aider, and local model agents can all work inside the same
                repo, but the operating system does not give them a shared concept of ownership,
                launch readiness, cost, or handoff state.
              </p>
              <p>
                The first thing that breaks is authority. An agent starts a dev server, another
                assumes a different runtime is current, and the browser or CLI may still be talking
                to yesterday's process. The system is alive, but nobody can prove it is the right
                live system.
              </p>
              <p>
                The second thing that breaks is ownership. Two agents edit the same module, both
                believe they are helping, and the repository records only the final diff. Without
                claims, locks, notes, and activity, the operator cannot see whether the work was
                coordinated or merely lucky.
              </p>
              <p>
                The third thing that breaks is recovery. An agent crashes halfway through a refactor.
                Its plan lived in the model context window. A new agent starts with a dirty tree and
                no trustworthy account of what changed, what was tested, or what must be preserved.
              </p>
              <p>
                These are not edge cases. They are the default behavior of multi-agent coding without
                a coordination substrate. Port Daddy exists to make the state visible enough for
                agents and humans to control.
              </p>
            </div>
          </motion.section>

          {/* Section 2: What Port Daddy Does */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <Anchor className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                What Port Daddy Actually Does
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Port Daddy runs locally and becomes the shared coordination service for the project.
                The CLI, FleetBar, Fleet Control Center, SDK, MCP server, scripts, and agent terminals
                all point back to the same durable state instead of inventing parallel stories.
              </p>
              <p>
                The foundation is named work. Sessions give an agent a purpose and lifecycle. Notes
                preserve decisions and evidence. File and region claims expose intended edits. Locks
                protect scarce resources. Channels, inboxes, and tuples let agents exchange signals
                without making the human relay every message.
              </p>
              <p>
                Around that substrate, the product adds operator surfaces: backend readiness before
                launch, resource pressure before spawning more work, guard checks before commit,
                salvage when agents disappear, and a Mac app that shows the current project without
                asking the user to remember which terminal tab is authoritative.
              </p>
            </div>
          </motion.section>

          {/* Section 3: How It Works, Step by Step */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <Terminal className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                A Concrete Example
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                You are working on a full-stack app. You want one agent to build an API, another to
                wire the frontend, and a third to keep tests and docs honest. Here is what that looks
                like with Port Daddy.
              </p>
              <p>
                <strong>Agent A (Claude Code)</strong> starts up and
                runs <code>pd begin --identity myapp:api --purpose "Build REST endpoints"</code>.
                Port Daddy registers it as an active agent, starts a session, and returns a session
                ID. The agent claims the routes and middleware it intends to touch, then leaves a
                note that states the invariant another model must preserve.
              </p>
              <p>
                <strong>Agent B (Cursor)</strong> starts up and
                runs <code>pd begin --identity myapp:frontend --purpose "Build React UI"</code>. Port
                Daddy registers it against the same project state. When it approaches the API route
                surface, the existing claim is visible before a write happens, so the agent can narrow
                scope or ask for a handoff instead of silently colliding.
              </p>
              <p>
                Agent A finishes the API and publishes a message: <code>pd pub myapp:events
                "api-ready"</code>. Agent B, which is subscribed to that scoped channel, receives the
                message and wires the frontend to the new endpoints. The important part is not the
                syntax; it is the durable event row that another tool can inspect later.
              </p>
              <p>
                If Agent A crashes mid-task, Port Daddy notices the heartbeat has stopped. It
                preserves Agent A's session notes, file claims, and purpose in a salvage queue.
                When a new agent runs <code>pd salvage</code>, it gets the context needed to continue
                from the last honest state instead of hallucinating a plan from the dirty tree.
              </p>
            </div>
          </motion.section>

          {/* Section 4: Core Concepts */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <Radio className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                Core Concepts, In Evaluation Order
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                <strong>Project identity</strong> is the root of the control plane. Every session,
                claim, channel, inbox, and fleet signal needs to attach to the actual checkout and
                project, not just a display name that can collide across worktrees.
              </p>
              <p>
                <strong>Sessions and notes</strong> are the recoverable memory. When an agent starts
                work, it opens a session. As it works, it appends progress, decisions, warnings, and
                validation to a durable log that the next agent can read.
              </p>
              <p>
                <strong>Channels, inboxes, and tuples</strong> are the shared-state layer. Agents can
                publish events, send durable role-owned messages, and write machine-readable facts
                that other tools can react to without parsing a chat transcript.
              </p>
              <p>
                <strong>Readiness and guardrails</strong> are the launch and commit boundary. Backend
                readiness, exact telemetry, budget ceilings, file claims, and guard checks make it
                possible to block unsafe work before it spends money or reaches history.
              </p>
              <p>
                <strong>Salvage</strong> is the recovery system. When an agent stops heartbeating,
                Port Daddy preserves session notes, file claims, purpose, and identity so another
                agent can claim the work and continue from evidence.
              </p>
            </div>
          </motion.section>

          {/* Section 5: Why This Matters */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <History className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                Why AI Infrastructure Teams Should Care
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                The model is not the whole product. Serious coding-agent systems also need a local
                operating layer that answers basic control questions: who owns this work, what did it
                touch, what can it spend, which backend is actually ready, and what evidence survives
                when the process dies?
              </p>
              <p>
                Port Daddy is valuable because it is intentionally below the scheduler. It can serve
                a hand-written terminal workflow, a FleetBar button, an MCP client, a Codex CLI task,
                a Claude Code session, or a local model loop without requiring those runtimes to agree
                on one orchestration framework.
              </p>
              <p>
                That is the acquisition-relevant point: the substrate is not another chat UI. It is
                the local truth layer that makes coding agents inspectable, recoverable, and safer to
                launch in real repositories.
              </p>
            </div>
          </motion.section>

          {/* Section 6: Who Is This For */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 flex items-center justify-center border border-[var(--border-subtle)] bg-[var(--interactive-active)]">
                <Shield className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                Who This Is For
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Port Daddy is for developers and AI tooling teams who run more than one coding agent
                against the same project. If you use Claude Code, Codex, Cursor, Gemini CLI, Aider,
                or local model agents in one repo, you have the shared-state problem Port Daddy solves.
              </p>
              <p>
                It is also for teams building agent-based automation. If you are using LangChain,
                CrewAI, AutoGen, MCP clients, custom schedulers, or internal agent loops, Port Daddy
                provides the local infrastructure layer those frameworks usually leave implicit:
                ownership, coordination, launch readiness, crash recovery, and operator evidence.
              </p>
              <p>
                You do not need Port Daddy for a single throwaway prompt. The value appears when agent
                work must be inspectable, concurrent, recoverable, and safe enough to run inside a
                repository a human or team actually cares about.
              </p>
            </div>
          </motion.section>

          {/* CTA */}
          <motion.div
            className="p-6 sm:p-8 border border-[var(--brand-primary)] bg-[var(--surface-raised)] flex flex-col items-center text-center gap-5"
            {...fadeUp}
          >
            <h3 className="text-2xl sm:text-3xl font-display font-black m-0 text-[var(--text-primary)]">
              Ready to try it?
            </h3>
            <p className="text-lg text-[var(--text-secondary)] max-w-lg m-0">
              Start with the Mac preview or the Getting Started tutorial, then evaluate the parts
              that matter for serious agent work: shared state, ownership, readiness, and recovery.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button asChild size="lg">
                <Link to="/tutorials/getting-started">
                  Getting Started
                  <ArrowRight size={20} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/docs">
                  Read the Docs
                </Link>
              </Button>
            </div>
          </motion.div>
        </article>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
