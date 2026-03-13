import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Globe, Shield, Cpu, Terminal, Sparkles } from 'lucide-react'

export function GettingStarted() {
  return (
    <TutorialLayout
      title="The First Handshake"
      description="Modern AI doesn't live in a silo. Whether you're using LangChain or CrewAI, Port Daddy is the unified orchestration layer that turns a collection of scripts into a resilient swarm."
      number="01"
      total="16"
      level="Beginner"
      readTime="5 min read"
      next={{ title: 'Multi-Agent Orchestration', href: '/tutorials/multi-agent' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-2 mb-4">
            <Sparkles className="text-[var(--p-amber-400)]" size={20} />
            <span className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)]">The Vision</span>
          </motion.div>
          <p>
            You've built an agent. It works. But then you build a second one. Suddenly, you're managing port conflicts, broken DNS, and manual environment variables. 
            <strong> Port Daddy was built to solve the "Second Agent Problem."</strong>
          </p>
          <p>
            By providing a stable, semantic identity for every service in your swarm, Port Daddy allows LangChain tools and CrewAI tasks to discover each other instantly, even across remote harbors.
          </p>
        </section>

        {/* Installation */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Terminal className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">1. Summon the Daemon</h2>
          </div>
          
          <div className="grid sm:grid-cols-2 gap-6">
            <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <Badge variant="teal">macOS / Linux</Badge>
              <CodeBlock language="bash">
                {`brew tap erichowens/port-daddy\nbrew install port-daddy`}
              </CodeBlock>
            </div>
            <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
              <Badge variant="neutral">Node.js / Global</Badge>
              <CodeBlock language="bash">
                {`npm install -g port-daddy`}
              </CodeBlock>
            </div>
          </div>

          <div className="bg-[var(--bg-overlay)] p-10 rounded-[40px] border border-[var(--border-subtle)]">
             <p className="text-sm uppercase tracking-widest font-black mb-6 opacity-40">Verification</p>
             <CodeBlock language="bash">{`pd start`}</CodeBlock>
             <p className="mt-6 mb-0 text-sm italic opacity-60">
               The daemon is now listening on <code>localhost:9876</code>. It is your swarm's lighthouse.
             </p>
          </div>
        </section>

        {/* Semantic Tokens */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Cpu className="text-[var(--p-amber-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Claim Your Identity</h2>
          </div>
          
          <p>
            Forget ports. Think in <strong>Semantic Tokens</strong>. Instead of remembering <code>localhost:3102</code>, your agent asks for <code>my-swarm:analyst:main</code>.
          </p>

          <CodeBlock language="bash">
            {`pd claim my-swarm:analyst:main`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-teal-500)]">
             <p className="font-bold text-[var(--text-primary)] m-0 mb-4 text-2xl font-display">Why this matters for LangChain/CrewAI:</p>
             <p className="m-0 text-lg">
               When you wrap a Port Daddy identity in a LangChain Tool, your LLM doesn't need to know the IP address. It just needs the token. If the service moves, Port Daddy updates the DNS instantly.
             </p>
          </blockquote>
        </section>

        {/* The Swarm Call */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--border-subtle)]">
              <Globe className="text-[var(--p-blue-400)]" size={24} />
            </div>
            <h2 className="m-0">3. Universal Discovery</h2>
          </div>

          <p>
            Whether your agent is a local process or a remote service in a distant Harbor, discovery is identical. 
          </p>

          <div className="grid gap-4">
             <div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="w-10 h-10 rounded-full bg-[var(--p-teal-500)]/10 flex items-center justify-center text-[var(--p-teal-400)] font-black">A</div>
                <div className="flex-1">
                   <p className="font-bold m-0 text-lg">Local Agent</p>
                   <p className="text-sm m-0 opacity-60">Uses <code>pd claim</code> to announce presence.</p>
                </div>
                <Badge variant="teal">Active</Badge>
             </div>
             <div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <div className="w-10 h-10 rounded-full bg-[var(--p-amber-500)]/10 flex items-center justify-center text-[var(--p-amber-400)] font-black">B</div>
                <div className="flex-1">
                   <p className="font-bold m-0 text-lg">Remote Harbor</p>
                   <p className="text-sm m-0 opacity-60">Connected via <code>pd tunnel</code>.</p>
                </div>
                <Badge variant="neutral">Connected</Badge>
             </div>
          </div>

          <div className="pt-12 text-center">
             <p className="text-2xl font-display font-bold mb-8">Ready to see it in action?</p>
             <div className="flex flex-wrap justify-center gap-6">
                <Button size="lg" className="rounded-full px-10 h-16 font-black tracking-wide" onClick={() => window.location.href = '/tutorials/multi-agent'}>
                  GO TO LESSON 02: ORCHESTRATION →
                </Button>
             </div>
          </div>
        </section>
      </motion.div>
    </TutorialLayout>
  )
}
