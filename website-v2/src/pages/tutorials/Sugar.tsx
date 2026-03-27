import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Terminal, Shield, Sparkles, Box, Lock, Activity } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Sugar() {
  return (
    <TutorialLayout
      title="Sugar Commands"
      description="Coordination shouldn't be a chore. Learn to use Port Daddy's high-level wrappers to claim ports, acquire locks, and manage sessions with zero friction."
      number={12}
      total={16}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: 'The Agent Inbox', href: '/tutorials/inbox' }}
      next={{ title: 'Swarm Bootstrapping', href: '/tutorials/spawn' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Sparkles className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Invisible Infrastructure</motion.h2>
          </motion.div>
          <motion.p>
            While Port Daddy provides a robust REST API for deep integrations, most humans and CLI-native agents prefer our <strong>Sugar Commands</strong>. These are high-level wrappers that combine multiple primitives into a single, intuitive action.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Zero Config</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Sugar commands auto-detect your project root and existing sessions so you don't have to pass IDs.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Shield size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Safe Defaults</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Built-in timeouts and retry logic ensure that your agent scripts are resilient to network blips.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Managed Sessions */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Activity className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. pd begin & pd done</motion.h2>
          </motion.div>

          <motion.p>
            Instead of manually creating a session and registering an agent, use <code>pd begin</code>. It writes the session state to a local file, allowing all subsequent commands to "just work."
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd begin --identity swarm:analyst\\
    --purpose "Analyze log files"\\
    --files "logs/*.log"`}
          </CodeBlock>

          <Surface depth="inset" radius="2xl" padding="none" className="p-8 border-l-4 border-[var(--brand-primary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               When the agent finishes, <code>pd done</code> releases all file claims and port assignments cleanly, closing the session timeline.
             </motion.p>
          </Surface>
        </section>

        {/* Step 2: Atomic Locks */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Lock className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. pd with-lock</motion.h2>
          </motion.div>

          <motion.p>
            Safely run any terminal command under a distributed lock. If the command fails, the daemon still ensures the lock is released after its TTL.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd with-lock db-migration -- npm run migrate\n\n✓ Lock acquired: db-migration\n✓ Running: npm run migrate...\n✓ Command complete. Lock released.`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-accent)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0 relative z-10">Productivity HUD</motion.p>
             <motion.div className="space-y-4 relative z-10">
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4">
                   <motion.div className="flex items-center gap-4">
                      <Terminal size={14} className="opacity-40" />
                      <code className="text-xs">pd whoami</code>
                   </motion.div>
                   <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">Identify current agent</motion.span>
                </Surface>
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4">
                   <motion.div className="flex items-center gap-4">
                      <Terminal size={14} className="opacity-40" />
                      <code className="text-xs">pd salvage</code>
                   </motion.div>
                   <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">Recover orphaned work</motion.span>
                </Surface>
             </motion.div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Box size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Efficiency Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Sweet Simplicity.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             Multi-agent coordination is complex, but the interface shouldn't be. Port Daddy's sugar commands turn deep infrastructure primitives into a "standard library" for your agent swarm prompts.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Anchor Protocol v4 Active
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
