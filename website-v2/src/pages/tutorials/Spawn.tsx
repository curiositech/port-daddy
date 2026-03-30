import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Surface } from '@/components/ui/Surface'
import { Cpu, Activity, Shield, Rocket } from 'lucide-react'

export function Spawn() {
  return (
    <TutorialLayout
      title="Swarm Bootstrapping"
      description="Coordination starts with instrumentation. Learn to use pd spawn to launch agent processes with sessions, heartbeats, and Swarm Radio auto-wired."
      number={11}
      total={16}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: 'Agent Inbox', href: '/tutorials/inbox' }}
      next={{ title: 'Cryptographic Harbors', href: '/tutorials/harbors' }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Rocket className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">The Orchestrator's Tool</h2>
          </div>
          <p>
            Launching an agent script is easy. Launching an agent that is <strong>aware</strong> of its swarm is hard. <code>pd spawn</code> is the orchestrator's command--it launches a sub-process and automatically wraps it in a managed Port Daddy session with full telemetry.
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            What you get automatically: <strong>Heartbeats</strong>, <strong>Session Logs</strong>, and <strong>Radio Wiring</strong>.
          </p>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Cpu className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">1. Summon an Agent</h2>
          </div>

          <p>
            Launch any agent backend (Claude, Gemini, Aider, etc.) through the daemon. We'll spawn a coding agent to fix a specific bug.
          </p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend aider --model gemini/flash \\
    --identity my-swarm:coder \\
    -- "Fix the CSS centering in website-v2/Hero.tsx"`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Port Daddy intercepts the agent's stdout/stderr and automatically converts meaningful output into <strong>Session Notes</strong> that other agents can read.
            </p>
          </Surface>
        </section>

        {/* Step 2: Telemetry */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--surface-sunken)] flex items-center justify-center">
              <Activity className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. Monitor the Pulse</h2>
          </div>

          <p>
            The daemon monitors the sub-process for heartbeats. If the agent hangs, crashes, or goes into an infinite loop, Port Daddy detects the failure and flags the session for <strong>Salvage</strong>.
          </p>

          <Surface depth="raised" radius="xl" className="p-5 space-y-4">
             <p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Daemon Telemetry</p>
             <Surface depth="inset" radius="xl" padding="none" className="flex items-center justify-between p-4">
                <span className="text-sm font-bold">agent-7f3a (coder) is active</span>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">CPU: 12%</span>
             </Surface>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="xl" className="p-6 space-y-4">
           <div className="flex items-center gap-3">
             <Shield size={18} className="text-[var(--brand-primary)]" />
             <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Fleet Maturity</p>
           </div>
           <p className="m-0 text-[var(--text-secondary)]">
             With <code>pd spawn</code>, you move from managing individual scripts to managing a <strong>coordinated fleet</strong>. The daemon provides the "glue" that allows agents from different families to coexist in a single, secure harbor. Daemon-managed lifecycle means every spawned agent gets sessions, heartbeats, and salvage for free.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
