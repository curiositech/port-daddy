import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Cpu, Zap, Activity, Terminal, RefreshCw, Share2, ArrowDown } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function AlwaysOn() {
  return (
    <TutorialLayout
      title="Always-On Avatars"
      description="Most agents are ephemeral. Learn to deploy persistent background processes that maintain harbor-scoped state and respond to global swarm signals 24/7."
      number={4}
      total={16}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Harbors', href: '/tutorials/harbors' }}
      next={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Cpu className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Beyond the Prompt</motion.h2>
          </motion.div>
          <motion.p>
            An <strong>Always-On Avatar</strong> is an agent process that doesn't terminate after a single task. It lives within a specific Harbor, maintaining a persistent local context and listening to <strong>Swarm Radio</strong> for instructions.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Persistent State</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Avatars can hold long-running variables, database connections, and cache in-memory across multiple user sessions.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Share2 size={20} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Event Driven</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Instead of polling, Avatars wake up instantly when a message hits a channel they are subscribed to.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Spawn a Background Agent</motion.h2>
          </motion.div>

          <motion.p>
            Use <code>pd spawn</code> to launch a persistent agent process. Port Daddy supports multiple backends: Claude, Ollama, Aider, and custom shell commands.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend claude \\
    --identity infra:monitor \\
    --purpose "Watch CI and auto-fix flakes" \\
    -- "Review the test failures in src/auth/"`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The avatar will immediately claim its semantic identity. Any other agent claiming <code>infra:monitor</code> will get the same port -- deterministic assignment means no conflicts.
            </p>
          </Surface>
        </section>

        {/* Step 2: Watching */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Wire the Trigger</motion.h2>
          </motion.div>

          <motion.p>
            Use <code>pd watch</code> to subscribe to a pub/sub channel and execute a command whenever a message arrives. The message content is available via environment variables.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd watch swarm:ci:failure \\
    --exec "./scripts/auto-fix.sh"

# Environment variables available in the script:
# PD_MESSAGE        — full message JSON
# PD_MESSAGE_CONTENT — message payload
# PD_CHANNEL        — channel name
# PD_TIMESTAMP      — event timestamp`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6">
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Coordination Loop</motion.p>
             <motion.div className="space-y-4">
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center gap-4 p-4">
                   <Badge variant="default">Trigger</Badge>
                   <motion.span className="text-sm font-bold">Agent publishes to swarm:ci:failure</motion.span>
                </Surface>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <Surface depth="raised" radius="2xl" className="flex items-center gap-4 p-4">
                   <Badge variant="teal">Action</Badge>
                   <motion.span className="text-sm font-bold">pd watch runs the --exec script</motion.span>
                </Surface>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center gap-4 p-4">
                   <Badge variant="default">Resolve</Badge>
                   <motion.span className="text-sm font-bold">Script publishes result back to Swarm Radio</motion.span>
                </Surface>
             </motion.div>
          </Surface>
        </section>

        {/* Self-Healing Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <RefreshCw size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Self-Healing Logic</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Resilient Avatars.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             What if the Avatar itself crashes? Port Daddy's <strong>Resurrection Queue</strong> holds the Avatar's harbor card and last-known notes in escrow. When you spawn a replacement, it automatically "inherits" the previous state and continues its watch.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
              <Zap size={14} className="animate-pulse" />
              SQLite-Backed Persistence
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
