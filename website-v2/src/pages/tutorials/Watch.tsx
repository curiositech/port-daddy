import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Eye, Zap, Activity, Terminal, Shield, Share2, RefreshCw, Layers, ArrowDown } from 'lucide-react'

export function Watch() {
  return (
    <TutorialLayout
      title="Swarm Observation"
      description="Coordination requires constant vigilance. Learn to use pd watch to monitor Swarm Radio channels and execute automated actions the moment a signal fires."
      number={14}
      total={16}
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Swarm Bootstrapping', href: '/tutorials/spawn' }}
      next={{ title: 'The Session State Machine', href: '/tutorials/session-phases' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Eye className="text-[var(--brand-accent)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Beyond Polling</motion.h2>
          </motion.div>
          <motion.p>
            In a reactive swarm, agents shouldn't waste cycles polling for state changes. <strong>Swarm Observation</strong> allows you to define "listeners" that stay dormant until a specific signal hits a <strong>Swarm Radio</strong> channel. When the signal fires, Port Daddy executes your script instantly.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Zap size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Sub-50ms Reaction</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">The moment an agent publishes a note or a message, your watcher script is spawned by the daemon.</motion.p>
             </motion.div>
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Layers size={20} className="text-[var(--p-blue-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Scriptable Swarms</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Use any local binary or shell script as a reactive "agent" that handles infrastructure tasks.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Watching */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Terminal className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Summon a Watcher</motion.h2>
          </motion.div>

          <motion.p>
            Use the <code>watch</code> command to link a channel to a local action. We'll watch for a "build-ready" signal and trigger an automated test suite.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd watch swarm:builds \\
    --exec "npm test" \\
    --filter "payload.status == 'ready'"`}
          </CodeBlock>

          <blockquote
            className="p-8 rounded-2xl border-l-4 border-[var(--brand-primary)]"
            style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
          >
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               Watchers run in the background. The daemon maintains the connection to Swarm Radio and ensures your script is only executed when the filter criteria are met.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Advanced Feedback */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Share2 className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Feedback Loops</motion.h2>
          </motion.div>

          <motion.p>
            Watcher scripts can report their own results back to the swarm by calling <code>pd pub</code> or <code>pd add-note</code>, creating a self-organizing feedback loop.
          </motion.p>

          <motion.div
            className="p-10 rounded-2xl space-y-8 relative overflow-hidden"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-accent)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Observation Chain</motion.p>

             <motion.div className="space-y-4">
                <motion.div
                  className="p-4 rounded-2xl flex items-center justify-between"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <motion.div className="flex items-center gap-4">
                      <motion.div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)]" />
                      <motion.span className="text-sm font-bold">Agent 'coder' publishes "fix-done"</motion.span>
                   </motion.div>
                   <Badge variant="teal">Event</Badge>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div
                  className="p-4 rounded-2xl flex items-center justify-between"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                >
                   <motion.div className="flex items-center gap-4">
                      <Terminal size={16} className="text-[var(--brand-primary)]" />
                      <motion.span className="text-sm font-bold text-[var(--brand-primary)]">Watcher triggers './run-ci.sh'</motion.span>
                   </motion.div>
                   <Badge variant="gold">Action</Badge>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div
                  className="p-4 rounded-2xl flex items-center justify-between opacity-60"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <motion.div className="flex items-center gap-4">
                      <RefreshCw size={16} />
                      <motion.span className="text-sm font-bold">CI publishes "tests-pass" to Swarm Radio</motion.span>
                   </motion.div>
                   <Badge variant="default">Loop</Badge>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Vision Callout */}
        <motion.div
          className="p-16 rounded-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Always Watching.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             In Port Daddy v3.7, observation is a first-class citizen. Your swarm shouldn't just act--it should <strong>perceive</strong>. The watch command gives your infrastructure the eyes it needs to stay in sync with your agents.
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
