import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Layout, Activity, Zap, Terminal, Globe, Share2, Heart } from 'lucide-react'

export function Dashboard() {
  return (
    <TutorialLayout
      title="Visual Control Plane"
      description="Coordination is hard to visualize in a terminal. Learn to use the Port Daddy HUD to monitor network graphs, lock contention, and real-time swarm telemetry."
      number="08"
      total="16"
      level="Beginner"
      readTime="5 min read"
      prev={{ title: 'Reactive Pipelines', href: '/tutorials/pipelines' }}
      next={{ title: 'Identity Discovery', href: '/tutorials/dns' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Layout className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">The Swarm HUD</motion.h2>
          </motion.div>
          <motion.p>
            The **Port Daddy Dashboard** (Heads-Up Display) provides a high-fidelity visual interface for your local daemon. It allows you to see the relationships between your agents, services, and harbors in real-time.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Share2 size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Live Network Map</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">A 2D force-directed graph showing which agents are connected to which harbors and tunnels.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Swarm Radio Feed</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">A unified chronological stream of every message, port claim, and session note across the mesh.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Launching */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Zap className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Summon the HUD</motion.h2>
          </motion.div>
          
          <motion.p>
            Launch the dashboard from your terminal. It runs as a local web app served directly from the daemon.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd dashboard\n\n✓ Dashboard active at http://localhost:3144/dashboard`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--brand-primary)]">
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               The dashboard uses **WebSockets** to ensure that any signal published to Swarm Radio appears on your screen with sub-50ms latency.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Interaction */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Terminal className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Real-time Intervention</motion.h2>
          </motion.div>

          <motion.p>
            The HUD isn't just for observation. You can manually eject rogue agents, clear stale port claims, and trigger pipeline rules directly from the interface.
          </motion.p>

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-8 shadow-2xl relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-tr from-[var(--p-teal-500)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">Visual Telemetry</motion.p>
             
             <motion.div className="grid sm:grid-cols-2 gap-6">
                <motion.div className="p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                   <motion.div className="flex items-center justify-between">
                      <motion.span className="text-[10px] font-black uppercase opacity-40">Lock Status</motion.span>
                      <Badge variant="amber">Contested</Badge>
                   </motion.div>
                   <motion.p className="text-xs font-bold">db-migration-lock</motion.p>
                   <motion.div className="h-1 w-full bg-[var(--border-subtle)] rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-[var(--p-amber-400)]" 
                        animate={{ width: ['20%', '80%', '40%'] }}
                        transition={{ duration: 4, repeat: Infinity }}
                      />
                   </motion.div>
                </motion.div>
                <motion.div className="p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                   <motion.div className="flex items-center justify-between">
                      <motion.span className="text-[10px] font-black uppercase opacity-40">Radio Traffic</motion.span>
                      <Badge variant="teal">High</Badge>
                   </motion.div>
                   <motion.div className="flex items-end gap-1 h-8">
                      {[1,2,3,4,5,6].map(i => (
                        <motion.div 
                          key={i} 
                          className="flex-1 bg-[var(--brand-primary)] rounded-t-sm" 
                          animate={{ height: [10, 30, 15, 25, 10][i%5] }}
                          transition={{ duration: 1, delay: i * 0.1, repeat: Infinity }}
                        />
                      ))}
                   </motion.div>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Vision Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Heart size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Visual Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>See Your Swarm.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Multi-agent coordination is often a "black box." The HUD turns that box transparent, allowing you to debug complex social dynamics between agents just as easily as you debug code.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Globe size={14} className="animate-spin-slow" />
              Unified Control Plane Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
