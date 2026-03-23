import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Cpu, Zap, Activity, Terminal, RefreshCw, Share2, ArrowDown } from 'lucide-react'

export function AlwaysOn() {
  return (
    <TutorialLayout
      title="Agent Spawning"
      description="Most agents are ephemeral. Learn to use pd spawn and pd watch to create persistent background agents that respond to pub/sub signals automatically."
      number="04"
      total="14"
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Harbors', href: '/tutorials/harbors' }}
      next={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Cpu className="text-[var(--p-teal-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Beyond the Prompt</motion.h2>
          </motion.div>
          <motion.p>
            A spawned agent is a background process launched by <code>pd spawn</code> that runs independently. Combined with <code>pd watch</code>, you can build agents that react to pub/sub signals automatically -- without polling.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Built-in Coordination</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Spawned agents get automatic sessions, heartbeats, notes, and salvage. Port Daddy wires it all silently.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <Share2 size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Event Driven</motion.h3>
                <motion.p className="text-sm opacity-60 m-0"><code>pd watch</code> subscribes to SSE channels and executes commands when messages arrive. No polling required.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Zap className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
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

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--brand-primary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               The spawned agent automatically registers with Port Daddy, starts a session, and begins sending heartbeats. If it crashes, its work enters the salvage queue for another agent to pick up.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Watching */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Terminal className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
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

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6">
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Coordination Loop</motion.p>
             <motion.div className="space-y-4">
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="neutral">Trigger</Badge>
                   <motion.span className="text-sm font-bold">Agent publishes to swarm:ci:failure</motion.span>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20 shadow-xl shadow-[var(--brand-primary)]/5">
                   <Badge variant="teal">Action</Badge>
                   <motion.span className="text-sm font-bold">pd watch runs the --exec script</motion.span>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="neutral">Resolve</Badge>
                   <motion.span className="text-sm font-bold">Script publishes result back to Swarm Radio</motion.span>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Salvage Callout */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-teal-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <RefreshCw size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Crash Recovery</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Salvage Queue.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             If a spawned agent crashes, Port Daddy preserves its session notes and file claims in the salvage queue. Run <code>pd salvage</code> to see dead agents and <code>pd salvage claim</code> to pick up where they left off.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-teal-400)]">
              <Zap size={14} className="animate-pulse" />
              SQLite-Backed Persistence
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
