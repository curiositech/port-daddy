import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Terminal, Users, Cpu, Globe } from 'lucide-react'

export function GettingStarted() {
  return (
    <TutorialLayout
      title="Getting Started"
      description="Install Port Daddy, start the daemon, and see how two AI agents coordinate on the same project without stepping on each other."
      number={1}
      total={21}
      level="Beginner"
      readTime="10 min read"
      next={{ title: 'Semantic Identities: Why Names Matter', href: '/tutorials/semantic-identities' }}
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
            You've built an agent. It works. But then you build a second one. Suddenly, you're managing port conflicts, broken DNS, and manual environment variables.
            <strong> Port Daddy was built to solve the "Second Agent Problem."</strong>
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
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Install</motion.h2>
          </motion.div>

          <div className="space-y-4">
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <Badge variant="teal">npm (recommended)</Badge>
              <CodeBlock language="bash">{`npm install -g port-daddy`}</CodeBlock>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-6 space-y-3">
              <Badge variant="default">From source</Badge>
              <CodeBlock language="bash">{`git clone https://github.com/curiositech/port-daddy.git
cd port-daddy
npm install
npm link`}</CodeBlock>
            </Surface>
          </div>

          <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
            <Badge variant="default">Verification</Badge>
            <CodeBlock language="bash">{`pd start`}</CodeBlock>
            <motion.p className="text-sm mb-0" style={{ color: 'var(--text-muted)' }}>
              The daemon is now listening on <code>localhost:9876</code>. It is your swarm's lighthouse.
            </motion.p>
          </Surface>
        </section>

        {/* Semantic Tokens */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Cpu className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Claim Your Identity</motion.h2>
          </motion.div>

          <motion.p>
            Forget port numbers. Name your services with <code>project:stack:context</code>. Port Daddy assigns the same port every time — the name IS the port.
          </motion.p>

          <CodeBlock language="bash">{`$ pd claim myapp:api:main
  Port 3100 assigned to myapp:api:main

$ pd claim myapp:frontend:main
  Port 3101 assigned to myapp:frontend:main

$ pd find 'myapp:*'
  myapp:api:main       → localhost:3100
  myapp:frontend:main  → localhost:3101`}</CodeBlock>

          <motion.p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            The three segments — <strong>project</strong>, <strong>stack</strong>, <strong>context</strong> — let you query across services with wildcards. <code>pd find &apos;myapp:*&apos;</code> returns everything in the project. <code>pd find &apos;*:api:*&apos;</code> returns every API across all projects.
          </motion.p>
        </section>

        {/* Start a Session */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Globe className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">3. Start a Session</motion.h2>
          </motion.div>

          <motion.p>
            Sessions track what each agent is doing. They hold notes, file claims, and timestamps — everything needed to recover if an agent crashes.
          </motion.p>

          <CodeBlock language="bash">{`$ pd begin --identity myapp:api --purpose "Building auth endpoints"
  Session started: session-a1b2c3d4
  Agent registered with heartbeat

$ pd note "Implementing JWT validation for /login"
  Note added to session

$ pd done
  Session completed. Notes preserved.`}</CodeBlock>

          <motion.p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            If an agent crashes instead of calling <code>pd done</code>, its session enters the salvage queue. Another agent can pick up the work with <code>pd salvage claim</code>.
          </motion.p>
        </section>

        {/* What's Next */}
        <section className="space-y-4">
          <motion.h2 className="m-0">What&apos;s Next</motion.h2>
          <motion.ul className="space-y-2" style={{ color: 'var(--text-secondary)' }}>
            <motion.li><a href="/tutorials/semantic-identities" style={{ color: 'var(--brand-primary)' }}>Semantic Identities</a> — deep dive into the naming system and wildcard queries</motion.li>
            <motion.li><a href="/tutorials/multi-agent" style={{ color: 'var(--brand-primary)' }}>Multi-Agent Orchestration</a> — coordinate two agents on the same project</motion.li>
            <motion.li><a href="/tutorials/fleet" style={{ color: 'var(--brand-primary)' }}>Fleet Agents</a> — background agents that fire on every commit</motion.li>
          </motion.ul>
        </section>
      </motion.div>
    </TutorialLayout>
  )
}
