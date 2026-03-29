import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Terminal, Users, Cpu, Globe } from 'lucide-react'
import { Button } from '@/components/ui/Button'

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

          <motion.div className="grid sm:grid-cols-2 gap-6">
            <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
              <Badge variant="teal">macOS / Linux</Badge>
              <CodeBlock language="bash">{`brew tap erichowens/port-daddy
brew install port-daddy`}</CodeBlock>
            </Surface>
            <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
              <Badge variant="default">Node.js / Global</Badge>
              <CodeBlock language="bash">{`npm install -g port-daddy`}</CodeBlock>
            </Surface>
          </motion.div>

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
            Forget ports. Think in <strong>Semantic Tokens</strong>. Instead of remembering <code>localhost:3102</code>, your agent asks for <code>my-swarm:analyst:main</code>.
          </motion.p>

          <CodeBlock language="bash">
            {`pd claim my-swarm:analyst:main`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <strong>Why this matters for LangChain/CrewAI:</strong> When you wrap a Port Daddy identity in a LangChain Tool, your LLM doesn't need to know the IP address. It just needs the token. If the service moves, Port Daddy updates the DNS instantly.
            </p>
          </Surface>
        </section>

        {/* Your First Claim */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Globe className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Your First Claim</motion.h2>
          </motion.div>

          <motion.p>
            Whether your agent is a local process or a remote service in a distant Harbor, discovery is identical.
          </motion.p>

          <motion.div className="grid gap-4">
             <Surface depth="raised" radius="2xl" className="flex items-center gap-6 p-6">
                <motion.div className="w-10 h-10 rounded-full bg-[var(--brand-secondary)]/10 flex items-center justify-center text-[var(--brand-secondary)] font-black">A</motion.div>
                <motion.div className="flex-1">
                   <motion.p className="font-bold m-0 text-lg">Local Agent</motion.p>
                   <motion.p className="text-sm m-0 opacity-60">Uses <code>pd claim</code> to announce presence.</motion.p>
                </motion.div>
                <Badge variant="teal">Active</Badge>
             </Surface>
             <Surface depth="raised" radius="2xl" className="flex items-center gap-6 p-6">
                <motion.div className="w-10 h-10 rounded-full bg-[var(--brand-accent)]/10 flex items-center justify-center text-[var(--brand-accent)] font-black">B</motion.div>
                <motion.div className="flex-1">
                   <motion.p className="font-bold m-0 text-lg">Remote Harbor</motion.p>
                   <motion.p className="text-sm m-0 opacity-60">Connected via <code>pd tunnel</code>.</motion.p>
                </motion.div>
                <Badge variant="default">Connected</Badge>
             </Surface>
          </motion.div>

          <motion.div className="pt-12 text-center">
             <motion.p className="text-2xl font-display font-bold mb-8">Ready to see it in action?</motion.p>
             <motion.div className="flex flex-wrap justify-center gap-6">
                <Button size="lg" className="rounded-full px-10 h-16 font-black tracking-wide" onClick={() => window.location.href = '/tutorials/multi-agent'}>
                  GO TO LESSON 02: ORCHESTRATION →
                </Button>
             </motion.div>
          </motion.div>
        </section>
      </motion.div>
    </TutorialLayout>
  )
}
