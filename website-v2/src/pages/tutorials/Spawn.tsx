import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Cpu, Zap, Activity, Shield, Share2, Rocket, RefreshCw } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

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
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Rocket className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">The Orchestrator's Tool</motion.h2>
          </motion.div>
          <motion.p>
            Launching an agent script is easy. Launching an agent that is **aware** of its swarm is hard. <code>pd spawn</code> is the orchestrator's command--it launches a sub-process and automatically wraps it in a managed Port Daddy session with full telemetry.
          </motion.p>
          <motion.div className="grid sm:grid-cols-3 gap-6 pt-4">
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest">Automatic</Badge>
                <motion.p className="text-xs font-bold m-0">Heartbeats</motion.p>
             </motion.div>
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="gold" className="text-[8px] font-black uppercase tracking-widest">Automatic</Badge>
                <motion.p className="text-xs font-bold m-0">Session Logs</motion.p>
             </motion.div>
             <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-3">
                <Badge variant="default" className="text-[8px] font-black uppercase tracking-widest">Automatic</Badge>
                <motion.p className="text-xs font-bold m-0">Radio Wiring</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Cpu className="text-[var(--brand-secondary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Summon an Agent</motion.h2>
          </motion.div>

          <motion.p>
            Launch any agent backend (Claude, Gemini, Aider, etc.) through the daemon. We'll spawn a coding agent to fix a specific bug.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd spawn --backend aider --model gemini/flash \\
    --identity my-swarm:coder \\
    -- "Fix the CSS centering in website-v2/Hero.tsx"`}
          </CodeBlock>

          <Surface depth="inset" radius="2xl" padding="none" className="p-8 border-l-4 border-[var(--brand-secondary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               Port Daddy intercepts the agent's stdout/stderr and automatically converts meaningful output into **Session Notes** that other agents can read.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Telemetry */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Activity className="text-[var(--brand-accent)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Monitor the Pulse</motion.h2>
          </motion.div>

          <motion.p>
            The daemon monitors the sub-process for heartbeats. If the agent hangs, crashes, or goes into an infinite loop, Port Daddy detects the failure and flags the session for <strong>Salvage</strong>.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-accent)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Daemon Telemetry</motion.p>
             <motion.div className="space-y-4">
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4">
                   <motion.div className="flex items-center gap-4">
                      <Zap size={16} className="text-[var(--brand-secondary)] animate-pulse" />
                      <motion.span className="text-sm font-bold">agent-7f3a (coder) is active</motion.span>
                   </motion.div>
                   <motion.span className="text-[10px] font-mono text-[var(--text-muted)]">CPU: 12%</motion.span>
                </motion.div>
                <Surface depth="inset" radius="2xl" padding="none" className="flex items-center justify-between p-4 opacity-40">
                   <motion.div className="flex items-center gap-4">
                      <RefreshCw size={16} />
                      <motion.span className="text-sm font-bold">Waiting for session note...</motion.span>
                   </motion.div>
                   <motion.span className="text-[10px] font-mono">Idle</motion.span>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Share2 size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Fleet Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Unified Bootstrapping.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             With <code>pd spawn</code>, you move from managing individual scripts to managing a <strong>coordinated fleet</strong>. The daemon provides the "glue" that allows agents from different families to coexist in a single, secure harbor.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Anchor Protocol v4 Secure
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
