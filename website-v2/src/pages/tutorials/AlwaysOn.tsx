import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Cpu, Zap, Terminal, RefreshCw, ArrowDown } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function AlwaysOn() {
  return (
    <TutorialLayout
      title="Always-On Avatars"
      description="Most agents are ephemeral. Learn to deploy persistent background processes that maintain harbor-scoped state and respond to global swarm signals 24/7."
      number={11}
      total={19}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Sugar Commands', href: '/tutorials/sugar' }}
      next={{ title: 'pd spawn: Launch Agent Fleets', href: '/tutorials/pd-spawn' }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Cpu className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Beyond the Prompt</h2>
          </div>
          <p>
            An <strong>Always-On Avatar</strong> is an agent process that doesn't terminate after a single task. It lives within a specific Harbor, maintaining a persistent local context and listening to <strong>Swarm Radio</strong> for instructions.
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            <strong>Persistent State</strong> -- Avatars hold long-running variables, database connections, and cache in-memory across multiple user sessions.
            <strong> Event Driven</strong> -- Instead of polling, Avatars wake up instantly when a message hits a subscribed channel.
          </p>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Zap className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Spawn a Background Agent</h2>
          </div>

          <p>
            Use <code>pd spawn</code> to launch the worker, then pair it with <code>pd watch</code> or fleet triggers if you want the pattern to stay reactive over time. Port Daddy supports multiple backends: Ollama, Codex, Claude, Claude CLI, Gemini, Aider, and custom shell commands.
          </p>

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
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Terminal className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Wire the Trigger</h2>
          </div>

          <p>
            Use <code>pd watch</code> to subscribe to a pub/sub channel and execute a command whenever a message arrives. The message content is available via environment variables.
          </p>

          <CodeBlock language="bash">
            {`$ pd watch swarm:ci:failure \\
    --exec "./scripts/auto-fix.sh"

# Environment variables available in the script:
# PD_MESSAGE        — full message JSON
# PD_MESSAGE_CONTENT — message payload
# PD_CHANNEL        — channel name
# PD_TIMESTAMP      — event timestamp`}
          </CodeBlock>

          <Surface depth="raised" radius="xl" className="p-5 space-y-3">
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Coordination Loop</p>
             <div className="space-y-2">
                <Surface depth="inset" radius="xl" padding="none" className="flex items-center gap-3 p-3">
                   <Badge variant="default">Trigger</Badge>
                   <span className="text-sm font-bold">Agent publishes to swarm:ci:failure</span>
                </Surface>
                <div className="flex justify-center"><ArrowDown size={14} className="opacity-20" /></div>
                <Surface depth="raised" radius="xl" className="flex items-center gap-3 p-3">
                   <Badge variant="teal">Action</Badge>
                   <span className="text-sm font-bold">pd watch runs the --exec script</span>
                </Surface>
                <div className="flex justify-center"><ArrowDown size={14} className="opacity-20" /></div>
                <Surface depth="inset" radius="xl" padding="none" className="flex items-center gap-3 p-3">
                   <Badge variant="default">Resolve</Badge>
                   <span className="text-sm font-bold">Script publishes result back to Swarm Radio</span>
                </Surface>
             </div>
          </Surface>
        </section>

        {/* Self-Healing Callout */}
        <Surface depth="raised" radius="xl" className="p-6 space-y-4">
           <div className="flex items-center gap-3">
             <RefreshCw size={18} className="text-[var(--brand-secondary)]" />
             <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Self-Healing Logic</p>
           </div>
           <p className="m-0 text-[var(--text-secondary)]">
             What if the Avatar itself crashes? Port Daddy's <strong>Resurrection Queue</strong> holds the Avatar's harbor card and last-known notes in escrow. When you spawn a replacement, it automatically "inherits" the previous state and continues its watch. SQLite-backed persistence ensures nothing is lost.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
