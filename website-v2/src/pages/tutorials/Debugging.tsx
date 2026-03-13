import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Search, Activity, Terminal, Shield, Zap, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Debugging() {
  return (
    <TutorialLayout
      title="Conflict Detection"
      description="Turn 2am EADDRINUSE nightmares into 5-second diagnoses. Learn to use Port Daddy's registry to find, identify, and resolve infrastructure collisions."
      number="04"
      total="16"
      level="Intermediate"
      readTime="14 min read"
      prev={{ title: 'Fleet Management', href: '/tutorials/monorepo' }}
      next={{ title: 'P2P Tunnels', href: '/tutorials/tunnel' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-red-400)]">
              <AlertTriangle className="text-[var(--p-red-400)]" size={24} />
            </div>
            <h2 className="m-0">The Horror Story</h2>
          </div>
          <p>
            It's 2am. You're deploying a hotfix. The staging server won't start. Your terminal screams in red: <code>Error: listen EADDRINUSE: address already in use :::3100</code>. In the old world, you'd reach for <code>lsof</code> and hope for the best.
          </p>
          
          <CodeBlock language="bash">
            {`$ lsof -i :3100\nCOMMAND   PID   USER   FD   TYPE   DEVICE   NAME\nnode    48291  erich   23u  IPv6   0x1a2b   *:3100`}
          </CodeBlock>

          <p className="opacity-60 italic text-sm">
            Great. You have a PID. But what service is it? Why did it start? And is it safe to kill?
          </p>
        </section>

        {/* Step 1: Identification */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Search className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">1. Identify the Squatter</h2>
          </div>
          
          <p>
            When every service claims its port through Port Daddy, you get a complete **Semantic Registry**. The <code>find</code> command tells you exactly who owns the port.
          </p>

          <CodeBlock language="bash">
            {`$ pd find :3100\n\n✓ Match Found:\n  - Identity:  payment-stack:api:main\n  - PID:       48291\n  - Started:   2 hours ago\n  - Status:    Healthy (200 OK)`}
          </CodeBlock>

          <div className="grid sm:grid-cols-2 gap-8 pt-4">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--p-teal-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Live Health</h3>
                <p className="text-sm opacity-60 m-0">Port Daddy checks if the process is actually responding, not just squatting on the socket.</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-blue-500)]/10 flex items-center justify-center">
                   <Shield size={20} className="text-[var(--p-blue-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Owner Track</h3>
                <p className="text-sm opacity-60 m-0">See exactly which agent or harbor created the claim to avoid accidental kills.</p>
             </div>
          </div>
        </section>

        {/* Step 2: Resolution */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Zap className="text-[var(--p-teal-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Heal the Harbor</h2>
          </div>

          <p>
            If a process is "zombie" (the agent died but the process didn't), use <code>pd release</code>. The daemon will attempt a graceful shutdown before forcefully reclaiming the port.
          </p>

          <CodeBlock language="bash">
            {`$ pd release :3100 --force\n\n✓ Sending SIGTERM to PID 48291...\n✓ Process terminated.\n✓ Port 3100 is now free for reclamation.`}
          </CodeBlock>

          <div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6 shadow-2xl relative overflow-hidden">
             <div className="absolute top-0 right-0 p-8 opacity-5">
                <RefreshCw size={100} className="animate-spin-slow" />
             </div>
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">Advanced Diagnostics</p>
             <CodeBlock language="bash">{`$ pd health --all`}</CodeBlock>
             <div className="space-y-2 relative z-10">
                <div className="flex items-center justify-between text-xs font-mono opacity-60">
                   <span>myapp:api</span>
                   <span className="text-[var(--status-success)]">HEALTHY</span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                   <span>myapp:worker</span>
                   <span className="text-[var(--p-red-400)] font-bold">UNHEALTHY (Connection Refused)</span>
                </div>
             </div>
          </div>
        </section>

        {/* Support CTA */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Still Stuck?</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Deep SDK Reference.</h3>
           <p className="text-xl max-w-xl opacity-70">
             The CLI manual contains detailed error codes and recovery patterns for every possible infrastructure collision.
           </p>
           <Link to="/docs" className="no-underline">
              <motion.button 
                className="px-10 py-5 rounded-full bg-[var(--brand-primary)] text-[var(--bg-base)] font-black text-sm flex items-center gap-2 transition-all"
                whileHover={{ scale: 1.05 }}
              >
                VIEW SDK MANUAL
                <ChevronRight size={16} />
              </motion.button>
           </Link>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
