import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Activity, Terminal, Shield, Layers, RefreshCw, ArrowDown, Radio } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Pipelines() {
  return (
    <TutorialLayout
      title="Reactive Workflows"
      description="Use pd watch and pd spawn to build event-driven workflows today. Declarative reactive pipelines are planned for v4."
      number={8}
      total={16}
      level="Advanced"
      readTime="10 min read"
      prev={{ title: 'Time-Travel Debugging', href: '/tutorials/time-travel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Planned Feature Notice */}
        <Surface depth="flat" radius="2xl" padding="md" className="border-l-4 border-[var(--brand-accent)]">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="gold" className="px-4 py-1 text-[10px] font-black uppercase tracking-widest">Coming in v4</Badge>
          </div>
          <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Declarative reactive pipelines (channel-to-action rules managed by the orchestrator) are planned for v4. Today, you can achieve similar results with <code>pd watch</code> and <code>pd spawn</code>, which are shipping now.
          </p>
        </Surface>

        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Layers className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Reactive Workflows Today</motion.h2>
          </motion.div>
          <motion.p>
            Port Daddy's pub/sub channels, <code>pd watch</code>, and <code>pd spawn</code> give you the building blocks for event-driven agent workflows right now. An agent publishes a message, a watcher picks it up, and a script or new agent responds.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">pd watch</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Subscribe to any pub/sub channel via SSE. Run a script whenever a message arrives.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <RefreshCw size={20} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">pd spawn</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Launch AI agents (ollama, claude, aider, gemini, or custom) with full Port Daddy coordination wired in.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: pd watch */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Radio className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Watch a Channel</motion.h2>
          </motion.div>

          <motion.p>
            Use <code>pd watch</code> to subscribe to a pub/sub channel and run a script every time a message arrives. The message content is passed via environment variables.
          </motion.p>

          <CodeBlock language="bash">
            {`# Watch the "test:fail" channel, run a fix script on each message
$ pd watch test:fail --exec ./scripts/auto-fix.sh

# Environment variables available in your script:
#   PD_MESSAGE         — full JSON message
#   PD_MESSAGE_CONTENT — message body text
#   PD_CHANNEL         — channel name (test:fail)
#   PD_TIMESTAMP       — ISO timestamp`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <code>pd watch</code> uses SSE with automatic reconnection. It stays running in the background, reacting to every message on the channel.
            </p>
          </Surface>
        </section>

        {/* Step 2: Combining watch + spawn */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Chain Watch + Spawn</motion.h2>
          </motion.div>

          <motion.p>
            Combine <code>pd watch</code> with <code>pd spawn</code> to create reactive agent chains. When one agent finishes and publishes a signal, a watcher can spawn the next agent in the pipeline.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
             <Badge variant="default">Example: Reactive Chain</Badge>

             <motion.div className="grid gap-4">
                <Surface depth="raised" radius="xl" className="flex items-center gap-4 p-4">
                   <Badge variant="teal" className="shrink-0">Step 1</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm">Agent publishes result</motion.p>
                      <code className="text-[10px]">pd pub task:ready "auth module complete"</code>
                   </motion.div>
                </Surface>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <Surface depth="raised" radius="xl" className="flex items-center gap-4 p-4">
                   <Badge variant="teal" className="shrink-0">Step 2</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm">Watcher triggers spawn</motion.p>
                      <code className="text-[10px]">pd watch task:ready --exec 'pd spawn --backend aider -- "Review $PD_MESSAGE_CONTENT"'</code>
                   </motion.div>
                </Surface>
             </motion.div>
          </Surface>

          <CodeBlock language="bash">
            {`# A complete reactive workflow in three terminals:

# Terminal 1: Watcher spawns a reviewer when code is ready
pd watch code:ready --exec 'pd spawn --backend aider -- "Review changes in $PD_MESSAGE_CONTENT"'

# Terminal 2: Watcher spawns tests when review passes
pd watch review:pass --exec './scripts/run-tests.sh'

# Terminal 3: Your coding agent publishes when done
pd pub code:ready "src/auth/login.ts"`}
          </CodeBlock>
        </section>

        {/* Roadmap Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">v4 Roadmap</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Declarative Pipelines.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             In v4, you will be able to define pipeline rules declaratively -- mapping channels to actions in a configuration file. The orchestrator will manage health checks and prevent runaway spawning. Until then, <code>pd watch</code> and <code>pd spawn</code> give you the same reactive power with shell scripts.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Available Today: pd watch + pd spawn
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
