import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Zap, Share2, Activity, Terminal, Shield, Globe, Layers, RefreshCw } from 'lucide-react'

export function Pipelines() {
  return (
    <TutorialLayout
      title="Reactive Pipelines"
      description="Turn your harbor into an event-driven DAG. Learn to define rules that automatically spawn agents, trigger scripts, or re-route traffic based on swarm signals."
      number="07"
      total="16"
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Time-Travel Debugging', href: '/tutorials/time-travel' }}
      next={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Layers className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">Beyond Static CI</h2>
          </div>
          <p>
            Standard CI/CD pipelines are static—they run on a schedule or a push. **Port Daddy Pipelines** are reactive. They live inside your harbor, watching Swarm Radio for specific signals and executing actions in real-time.
          </p>
          <div className="grid sm:grid-cols-2 gap-8 pt-4">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--p-teal-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Event Triggers</h3>
                <p className="text-sm opacity-60 m-0">Fire actions based on any pub/sub message, port claim, or agent note event.</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <RefreshCw size={20} className="text-[var(--p-amber-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Auto-Healing</h3>
                <p className="text-sm opacity-60 m-0">Automatically spawn debugger agents when your swarm reports a failure.</p>
             </div>
          </div>
        </section>

        {/* Step 1: Defining Rules */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Terminal className="text-[var(--p-blue-400)]" size={24} />
            </div>
            <h2 className="m-0">1. Define a Rule</h2>
          </div>
          
          <p>
            Use the <code>orchestrator</code> command to link a Swarm Radio channel to an autonomous action.
          </p>

          <CodeBlock language="bash">
            {`$ pd orchestrator add "Auto-Fix" \\
    --channel "test:fail" \\
    --action "pd spawn --backend aider -- model-check src/auth/"`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--p-blue-400)]">
             <p className="m-0 text-sm italic opacity-60 font-medium">
               This rule creates a persistent watcher. Whenever any agent publishes to <code>test:fail</code>, the daemon will spawn a new coding agent to investigate.
             </p>
          </blockquote>
        </section>

        {/* Step 2: Complex DAGs */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-purple-400)]">
              <Share2 className="text-[var(--p-purple-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Chain Your Swarm</h2>
          </div>

          <p>
            By chaining multiple rules, you build a **Dynamic DAG**. Each agent finishes its work by publishing a signal that triggers the next set of agents in the harbor.
          </p>

          <div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
             <div className="absolute inset-0 bg-gradient-to-b from-[var(--p-teal-500)]/5 to-transparent" />
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The DAG Flow</p>
             
             <div className="grid gap-6">
                <div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="teal" className="shrink-0">Node 01</Badge>
                   <div className="flex-1">
                      <p className="font-bold m-0 text-sm">Planner finishes task</p>
                      <code className="text-[10px] opacity-40">pub task:ready</code>
                   </div>
                </div>
                <div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></div>
                <div className="flex items-center gap-6 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20 shadow-lg">
                   <Badge variant="amber" className="shrink-0 text-white bg-[var(--brand-primary)]">Auto-Action</Badge>
                   <div className="flex-1">
                      <p className="font-bold m-0 text-sm text-[var(--brand-primary)]">Spawn Coder + Reviewer</p>
                      <code className="text-[10px] opacity-40">pd spawn (x2)</code>
                   </div>
                </div>
             </div>
          </div>
        </section>

        {/* Resilience Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-teal-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Convergent Pipelines.</h3>
           <p className="text-xl max-w-xl opacity-70">
             Unlike rigid JSON pipelines, Port Daddy DAGs are <strong>state-aware</strong>. The orchestrator checks if the harbor is healthy before spawning new nodes, ensuring your swarm doesn't runaway during a system failure.
           </p>
           <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-teal-400)]">
              <Shield size={14} className="animate-pulse" />
              Anchor Protocol v4 Verified
           </div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}

import { ArrowDown } from 'lucide-react'
