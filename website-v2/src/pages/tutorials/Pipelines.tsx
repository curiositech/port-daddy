import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Share2, Activity, Terminal, Shield, Layers, RefreshCw, ArrowDown } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function Pipelines() {
  return (
    <TutorialLayout
      title="Reactive Pipelines"
      description="Turn your harbor into an event-driven DAG. Learn to define rules that automatically spawn agents, trigger scripts, or re-route traffic based on swarm signals."
      number={8}
      total={16}
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Time-Travel Debugging', href: '/tutorials/time-travel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Layers className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Beyond Static CI</motion.h2>
          </motion.div>
          <motion.p>
            Standard CI/CD pipelines are static--they run on a schedule or a push. <strong>Port Daddy Pipelines</strong> are reactive. They live inside your harbor, watching Swarm Radio for specific signals and executing actions in real-time.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Event Triggers</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Fire actions based on any pub/sub message, port claim, or agent note event.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <RefreshCw size={20} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Auto-Healing</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Automatically spawn debugger agents when your swarm reports a failure.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Defining Rules */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Define a Rule</motion.h2>
          </motion.div>

          <motion.p>
            Use the <code>orchestrator</code> command to link a Swarm Radio channel to an autonomous action.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd orchestrator add "Auto-Fix" \\
    --channel "test:fail" \\
    --action "pd spawn --backend aider -- model-check src/auth/"`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              This rule creates a persistent watcher. Whenever any agent publishes to <code>test:fail</code>, the daemon will spawn a new coding agent to investigate.
            </p>
          </Surface>
        </section>

        {/* Step 2: Complex DAGs */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Share2 className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Chain Your Swarm</motion.h2>
          </motion.div>

          <motion.p>
            By chaining multiple rules, you build a <strong>Dynamic DAG</strong>. Each agent finishes its work by publishing a signal that triggers the next set of agents in the harbor.
          </motion.p>

          <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
             <Badge variant="default">The DAG Flow</Badge>

             <motion.div className="grid gap-4">
                <Surface depth="raised" radius="xl" className="flex items-center gap-4 p-4">
                   <Badge variant="teal" className="shrink-0">Node 01</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm">Planner finishes task</motion.p>
                      <code className="text-[10px]">pub task:ready</code>
                   </motion.div>
                </Surface>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <Surface depth="raised" radius="xl" className="flex items-center gap-4 p-4">
                   <Badge variant="teal" className="shrink-0">Node 02</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm">Spawn Coder + Reviewer</motion.p>
                      <code className="text-[10px]">pd spawn (x2)</code>
                   </motion.div>
                </Surface>
             </motion.div>
          </Surface>
        </section>

        {/* Resilience Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent Pipelines.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             Unlike rigid JSON pipelines, Port Daddy DAGs are <strong>state-aware</strong>. The orchestrator checks if the harbor is healthy before spawning new nodes, ensuring your swarm doesn't runaway during a system failure.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Reactive Automation
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
