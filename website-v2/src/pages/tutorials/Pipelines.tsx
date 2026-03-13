import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Share2, Activity, Terminal, Shield, Layers, RefreshCw, ArrowDown } from 'lucide-react'

export function Pipelines() {
  return (
    <TutorialLayout
      title="Reactive Pipelines"
      description="Turn your harbor into an event-driven DAG. Learn to define rules that automatically spawn agents, trigger scripts, or re-route traffic based on swarm signals."
      number="08"
      total="16"
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Time-Travel Debugging', href: '/tutorials/time-travel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Layers className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Beyond Static CI</motion.h2>
          </motion.div>
          <motion.p>
            Standard CI/CD pipelines are static—they run on a schedule or a push. **Port Daddy Pipelines** are reactive. They live inside your harbor, watching Swarm Radio for specific signals and executing actions in real-time.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Event Triggers</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Fire actions based on any pub/sub message, port claim, or agent note event.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <RefreshCw size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Auto-Healing</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Automatically spawn debugger agents when your swarm reports a failure.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Defining Rules */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Terminal className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
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

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-blue-400)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               This rule creates a persistent watcher. Whenever any agent publishes to <code>test:fail</code>, the daemon will spawn a new coding agent to investigate.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Complex DAGs */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-purple-400)]">
              <Share2 className="text-[var(--p-purple-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Chain Your Swarm</motion.h2>
          </motion.div>

          <motion.p>
            By chaining multiple rules, you build a **Dynamic DAG**. Each agent finishes its work by publishing a signal that triggers the next set of agents in the harbor.
          </motion.p>

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-b from-[var(--p-teal-500)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The DAG Flow</motion.p>
             
             <motion.div className="grid gap-6">
                <motion.div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="teal" className="shrink-0">Node 01</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm">Planner finishes task</motion.p>
                      <code className="text-[10px] opacity-40">pub task:ready</code>
                   </motion.div>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20 shadow-lg">
                   <Badge variant="amber" className="shrink-0 text-white bg-[var(--brand-primary)]">Auto-Action</Badge>
                   <motion.div className="flex-1">
                      <motion.p className="font-bold m-0 text-sm text-[var(--brand-primary)]">Spawn Coder + Reviewer</motion.p>
                      <code className="text-[10px] opacity-40">pd spawn (x2)</code>
                   </motion.div>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Resilience Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-teal-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent Pipelines.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Unlike rigid JSON pipelines, Port Daddy DAGs are <strong>state-aware</strong>. The orchestrator checks if the harbor is healthy before spawning new nodes, ensuring your swarm doesn't runaway during a system failure.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Anchor Protocol v4 Verified
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
