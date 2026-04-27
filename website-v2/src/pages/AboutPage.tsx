import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
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
      className="min-h-screen bg-[var(--surface-base)] flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero */}
      <motion.section
        className="py-24 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden"
        style={{ background: 'var(--surface-raised)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[700px] h-[700px] rounded-full blur-[160px] opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

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
            The daemon that keeps <br />
            <span className="text-[var(--brand-primary)]">multi-agent chaos in check.</span>
          </motion.h1>

          <motion.p
            className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-2xl"
            {...fadeUp}
          >
            Port Daddy is a lightweight local daemon that coordinates AI coding agents
            working on the same project. Install it once, and your agents stop fighting
            over ports, files, and processes.
          </motion.p>
        </motion.div>
      </motion.section>

      {/* Main Content - Long-form prose */}
      <motion.main className="flex-1 max-w-3xl mx-auto w-full px-6 sm:px-8 lg:px-10 py-12">
        <article className="space-y-16">

          {/* Section 1: The Problem */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <Users className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                The Problem: Agent Chaos
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Imagine you have Claude Code building the API layer of your app while Cursor is
                working on the frontend and a third Gemini CLI agent is writing database migrations.
                Each agent is individually capable, but none of them knows the others exist.
              </p>
              <p>
                The first thing that breaks is ports. Claude Code starts a dev server on port 3000.
                Cursor tries to start its Vite server on port 3000. It gets <code>EADDRINUSE</code> and
                either crashes or silently picks a different port that nothing else knows about. Now
                your frontend is trying to proxy API calls to a port that the API server is not
                actually running on.
              </p>
              <p>
                The second thing that breaks is files. Both Claude Code and Gemini are editing
                <code>src/db/schema.ts</code> at the same time. They do not know about each other, so
                one agent silently overwrites the other's changes. You lose work, and worse, you might
                not notice until much later when the schema no longer matches what the migration
                expects.
              </p>
              <p>
                The third thing that breaks is recovery. An agent crashes halfway through a refactor.
                It was tracking its progress in its own context window, which is now gone. A new agent
                starts up, has no idea what the previous one was doing, and either redoes the work or
                starts from a broken intermediate state.
              </p>
              <p>
                These are not edge cases. They are the default behavior of every multi-agent setup
                without coordination infrastructure. Port Daddy exists to make them impossible.
              </p>
            </div>
          </motion.section>

          {/* Section 2: What Port Daddy Does */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <Anchor className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                What Port Daddy Actually Does
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Port Daddy is a single daemon that runs on <code>localhost:9876</code>. It starts when
                your machine boots and stays running in the background. Every agent, script, and dev
                server talks to the same daemon, which gives it a single source of truth about what
                is running, who owns what, and what just happened.
              </p>
              <p>
                The foundation is <strong>deterministic port assignment</strong>. Instead of
                hardcoding port numbers or hoping for the best, you give each service a semantic
                identity like <code>myapp:api:main</code> or <code>myapp:frontend:feature-auth</code>.
                Port Daddy hashes that identity into a stable port number. The same identity always
                gets the same port, across restarts, across machines, across agents. You
                run <code>pd claim myapp:api</code> and get back <code>3001</code> every time.
              </p>
              <p>
                On top of that, Port Daddy provides the coordination primitives that agents need to
                work together safely: <strong>file claims</strong> so agents announce which files they
                are touching, <strong>distributed locks</strong> so only one agent runs a database
                migration at a time, <strong>pub/sub messaging</strong> so agents can signal each
                other in real time, and <strong>sessions with notes</strong> so every agent leaves an
                immutable audit trail of what it did and why.
              </p>
            </div>
          </motion.section>

          {/* Section 3: How It Works, Step by Step */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <Terminal className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                A Concrete Example
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                You are working on a full-stack app. You want Claude Code to build the API and Cursor
                to build the frontend, running simultaneously. Here is what that looks like with Port
                Daddy.
              </p>
              <p>
                <strong>Agent A (Claude Code)</strong> starts up and
                runs <code>pd begin --identity myapp:api --purpose "Build REST endpoints"</code>.
                Port Daddy registers it as an active agent, starts a session, and returns a session
                ID. Claude Code then runs <code>pd claim myapp:api</code> to get a stable port for
                the Express server and <code>pd session files add src/routes/ src/middleware/</code> to
                announce which files it plans to touch.
              </p>
              <p>
                <strong>Agent B (Cursor)</strong> starts up and
                runs <code>pd begin --identity myapp:frontend --purpose "Build React UI"</code>. Port
                Daddy registers it, and because it knows Agent A is already working on the same
                project, it returns a hint: "1 active agent in myapp:*". Cursor
                claims <code>myapp:frontend</code> for its Vite dev server and gets a different port
                automatically. When it tries to claim <code>src/routes/api.ts</code>, Port Daddy
                returns a conflict warning because Agent A already claimed that directory.
              </p>
              <p>
                Agent A finishes the API and publishes a message: <code>pd pub myapp:events
                "api-ready"</code>. Agent B, which is subscribed to that channel, receives the
                message instantly and begins wiring up the frontend to call the new endpoints. No
                polling. No shared files. No race conditions.
              </p>
              <p>
                If Agent A crashes mid-task, Port Daddy notices the heartbeat has stopped. It
                preserves Agent A's session notes, file claims, and purpose in a salvage queue.
                When a new agent starts up and runs <code>pd salvage</code>, it gets the full
                context of what Agent A was doing and can pick up from where it left off.
              </p>
            </div>
          </motion.section>

          {/* Section 4: Core Concepts */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <Radio className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                Core Concepts, In Order of Complexity
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                <strong>Semantic Identities</strong> are the addressing system.
                Everything in Port Daddy is referenced by a string
                like <code>project:stack:context</code>. This replaces hardcoded port numbers, PIDs,
                and magic environment variables with human-readable names that stay stable across
                restarts.
              </p>
              <p>
                <strong>Sessions and Notes</strong> are the audit trail. When an agent starts work, it
                opens a session. As it works, it appends notes -- progress updates, decisions,
                warnings -- to an immutable log. Notes are never edited or deleted. This means you can
                always reconstruct what happened, in what order, and why.
              </p>
              <p>
                <strong>Pub/Sub Channels</strong> are the communication layer. Agents publish messages
                to named channels and subscribe to messages on other channels. Messages are delivered
                via Server-Sent Events, so there is no polling and no missed messages. You can also
                attach a watcher that runs a shell command every time a message arrives, which is how
                you build reactive pipelines.
              </p>
              <p>
                <strong>Salvage</strong> is the crash recovery system. Port Daddy monitors agent
                heartbeats. When an agent stops sending heartbeats, the daemon moves it to a salvage
                queue and preserves its full context: session notes, file claims, purpose, and
                identity. A new agent can claim that work and continue from where the dead agent left
                off instead of starting from scratch.
              </p>
              <p>
                <strong>Harbors</strong> are the security layer. A harbor is a named permission
                namespace. You define what capabilities agents inside the harbor have -- read code,
                write notes, create tunnels, acquire locks -- and Port Daddy issues HMAC-signed JWT
                tokens that enforce those boundaries. Agents outside the harbor cannot access
                resources inside it.
              </p>
            </div>
          </motion.section>

          {/* Section 5: The Maritime Metaphor */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <History className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                About the Maritime Theme
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                You will notice a lot of nautical language throughout Port Daddy: harbors, salvage,
                lighthouses, signal flags. This is not just decoration. The metaphor maps cleanly to
                the problem domain.
              </p>
              <p>
                A <strong>harbor</strong> is a protected space where ships (agents) can dock safely
                without crashing into each other -- which is exactly what a permission namespace does
                for agent processes. <strong>Salvage</strong> is the practice of recovering cargo from
                a wrecked ship -- which is exactly what happens when you pick up a crashed agent's
                session notes and file claims. The <strong>port authority</strong> is the office that
                assigns berths to incoming ships -- which is exactly what deterministic port assignment
                does.
              </p>
              <p>
                The metaphor is a convenience, not a requirement. You do not need to think in
                nautical terms to use Port Daddy. The CLI uses plain language (<code>pd begin</code>,
                <code>pd done</code>, <code>pd note</code>) and the API uses standard REST
                conventions. But when you see the word "harbor" in the docs, now you know what it
                means: a security boundary for a group of agents.
              </p>
            </div>
          </motion.section>

          {/* Section 6: Who Is This For */}
          <motion.section className="space-y-5" {...fadeUp}>
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center border"
                style={{ background: 'var(--interactive-active)', borderColor: 'var(--border-subtle)' }}
              >
                <Shield className="text-[var(--brand-primary)]" size={24} />
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-black tracking-tight m-0 text-[var(--text-primary)]">
                Who This Is For
              </h2>
            </div>

            <div className="space-y-4 text-lg leading-relaxed text-[var(--text-secondary)]">
              <p>
                Port Daddy is for developers who run more than one AI coding agent at the same
                time. If you use Claude Code, Cursor, Gemini CLI, Aider, or any combination of
                these in the same project, you have the coordination problem that Port Daddy solves.
              </p>
              <p>
                It is also for teams building agent-based automation. If you are using LangChain,
                CrewAI, or AutoGen to build multi-agent pipelines, Port Daddy provides the
                infrastructure layer that those frameworks do not: port management, file coordination,
                crash recovery, and security isolation.
              </p>
              <p>
                You do not need Port Daddy if you only run a single AI agent at a time. The value
                comes from coordination, and coordination only matters when there is more than one
                actor. But the moment you run a second agent on the same project, you will want it.
              </p>
            </div>
          </motion.section>

          {/* CTA */}
          <motion.div
            className="p-6 sm:p-8 rounded-[48px] border border-[var(--brand-primary)] bg-[var(--surface-raised)] flex flex-col items-center text-center gap-5"
            {...fadeUp}
          >
            <h3 className="text-2xl sm:text-3xl font-display font-black m-0 text-[var(--text-primary)]">
              Ready to try it?
            </h3>
            <p className="text-lg text-[var(--text-secondary)] max-w-lg m-0">
              Port Daddy installs in under a minute. The Getting Started tutorial walks you from
              zero to a coordinated two-agent workflow in five minutes.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link to="/tutorials/getting-started" className="no-underline">
                <button className="px-10 py-5 rounded-full bg-[var(--brand-primary)] text-white font-black text-lg hover:scale-105 transition-transform flex items-center gap-2">
                  Getting Started
                  <ArrowRight size={20} />
                </button>
              </Link>
              <Link to="/docs" className="no-underline">
                <button className="px-10 py-5 rounded-full bg-[var(--surface-overlay)] text-[var(--text-primary)] border-2 border-[var(--border-strong)] font-black text-lg hover:bg-[var(--interactive-hover)] transition-all">
                  Read the Docs
                </button>
              </Link>
            </div>
          </motion.div>
        </article>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
