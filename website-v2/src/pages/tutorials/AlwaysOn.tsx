import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Cpu, Zap, Activity, Terminal, RefreshCw, Globe, Share2 } from 'lucide-react'

export function AlwaysOn() {
  return (
    <TutorialLayout
      title="Always-On Avatars"
      description="Most agents are ephemeral. Learn to deploy persistent background processes that maintain harbor-scoped state and respond to global swarm signals 24/7."
      number="04"
      total="16"
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'Cryptographic Harbors', href: '/tutorials/harbors' }}
      next={{ title: 'P2P Tunnels', href: '/tutorials/tunnel' }}
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
            An **Always-On Avatar** is an agent process that doesn't terminate after a single task. It lives within a specific Harbor, maintaining a persistent local context and listening to **Swarm Radio** for instructions.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Persistent State</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Avatars can hold long-running variables, database connections, and cache in-memory across multiple user sessions.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <Share2 size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Event Driven</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Instead of polling, Avatars wake up instantly when a message hits a channel they are subscribed to.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Spawning */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Zap className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Summon an Avatar</motion.h2>
          </motion.div>
          
          <motion.p>
            Use the <code>--avatar</code> flag with <code>pd spawn</code> to launch a persistent process. We'll give it the identity <code>infra:monitor</code>.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd spawn --avatar --identity infra:monitor \\
    --purpose "Watch CI and auto-fix flakes" \\
    -- "npm run monitor-swarm"`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--brand-primary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               Note: The avatar will immediately claim its semantic identity. Any other agent trying to claim <code>infra:monitor</code> will be blocked by the daemon until the avatar releases it.
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
            Now we need to tell the Avatar when to act. We'll use <code>pd watch</code> to bridge a Swarm Radio channel to our Avatar's input.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd watch swarm:ci:failure \\
    --exec "pd pub infra:monitor:task 'fix-build'"`}
          </CodeBlock>

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6">
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Coordination Loop</motion.p>
             <motion.div className="space-y-4">
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="neutral">Trigger</Badge>
                   <motion.span className="text-sm font-bold">CI Fails</motion.span>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--brand-primary)]/20 shadow-xl shadow-[var(--brand-primary)]/5">
                   <Badge variant="teal">Action</Badge>
                   <motion.span className="text-sm font-bold">Avatar wakes up and clones the broken branch</motion.span>
                </motion.div>
                <motion.div className="flex justify-center"><ArrowDown size={16} className="opacity-20" /></motion.div>
                <motion.div className="flex items-center gap-4 p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <Badge variant="neutral">Resolve</Badge>
                   <motion.span className="text-sm font-bold">Avatar publishes "fixed" to Swarm Radio</motion.span>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Self-Healing Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-teal-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <RefreshCw size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Self-Healing Logic</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Resilient Avatars.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             What if the Avatar itself crashes? Port Daddy's **Resurrection Queue** holds the Avatar's harbor card and last-known notes in escrow. When you spawn a replacement, it automatically "inherits" the previous state and continues its watch.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-teal-400)]">
              <Globe size={14} className="animate-spin-slow" />
              Distributed State Sync Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}

import { ArrowDown } from 'lucide-react'
