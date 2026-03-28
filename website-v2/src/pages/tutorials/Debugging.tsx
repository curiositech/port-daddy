import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Search, Activity, Shield, Zap, AlertTriangle, RefreshCw, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Surface } from '@/components/ui/Surface'

export function Debugging() {
  return (
    <TutorialLayout
      title="Conflict Detection"
      description="Turn 2am EADDRINUSE nightmares into 5-second diagnoses. Learn to use Port Daddy's registry to find, identify, and resolve infrastructure collisions."
      number={4}
      total={16}
      level="Intermediate"
      readTime="14 min read"
      prev={{ title: 'Fleet Management', href: '/tutorials/monorepo' }}
      next={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <AlertTriangle className="text-[var(--status-error)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">The Horror Story</motion.h2>
          </motion.div>
          <motion.p>
            It's 2am. You're deploying a hotfix. The staging server won't start. Your terminal screams in red: <code>Error: listen EADDRINUSE: address already in use :::3100</code>. In the old world, you'd reach for <code>lsof</code> and hope for the best.
          </motion.p>

          <CodeBlock language="bash">
            {`$ lsof -i :3100\nCOMMAND   PID   USER   FD   TYPE   DEVICE   NAME\nnode    48291  erich   23u  IPv6   0x1a2b   *:3100`}
          </CodeBlock>

          <motion.p className="text-[var(--text-secondary)] italic text-sm">
            Great. You have a PID. But what service is it? Why did it start? And is it safe to kill?
          </motion.p>
        </section>

        {/* Step 1: Identification */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Search className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Identify the Squatter</motion.h2>
          </motion.div>

          <motion.p>
            When every service claims its port through Port Daddy, you get a complete <strong>Semantic Registry</strong>. The <code>find</code> command tells you exactly who owns the port.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd find :3100\n\n✓ Match Found:\n  - Identity:  payment-stack:api:main\n  - PID:       48291\n  - Started:   2 hours ago\n  - Status:    Healthy (200 OK)`}
          </CodeBlock>

          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Activity size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Live Health</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Port Daddy checks if the process is actually responding, not just squatting on the socket.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Shield size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Owner Track</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">See exactly which agent or harbor created the claim to avoid accidental kills.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 2: Resolution */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Heal the Harbor</motion.h2>
          </motion.div>

          <motion.p>
            If a process is "zombie" (the agent died but the process didn't), use <code>pd release</code>. The daemon will attempt a graceful shutdown before forcefully reclaiming the port.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd release :3100 --force\n\n✓ Sending SIGTERM to PID 48291...\n✓ Process terminated.\n✓ Port 3100 is now free for reclamation.`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute top-0 right-0 p-8 opacity-5">
                <RefreshCw size={100} className="animate-spin-slow" />
             </motion.div>
             <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0 relative z-10">Advanced Diagnostics</motion.p>
             <CodeBlock language="bash">{`$ pd health --all`}</CodeBlock>
             <motion.div className="space-y-2 relative z-10">
                <motion.div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                   <motion.span>myapp:api</motion.span>
                   <motion.span className="text-[var(--status-success)]">HEALTHY</motion.span>
                </motion.div>
                <motion.div className="flex items-center justify-between text-xs font-mono">
                   <motion.span>myapp:worker</motion.span>
                   <motion.span className="text-[var(--status-error)] font-bold">UNHEALTHY (Connection Refused)</motion.span>
                </motion.div>
             </motion.div>
          </Surface>
        </section>

        {/* Support CTA */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Still Stuck?</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Deep SDK Reference.</motion.h3>
           <motion.p className="text-xl max-w-xl text-[var(--text-secondary)]">
             The CLI manual contains detailed error codes and recovery patterns for every possible infrastructure collision.
           </motion.p>
           <Link to="/docs" className="no-underline">
              <motion.button
                className="px-10 py-5 rounded-2xl text-[var(--text-inverse)] font-black text-sm flex items-center gap-2 transition-all"
                style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-sm)' }}
                whileHover={{ scale: 1.05 }}
              >
                VIEW SDK MANUAL
                <ChevronRight size={16} />
              </motion.button>
           </Link>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
