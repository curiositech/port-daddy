import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Search, Activity, Shield, Zap, AlertTriangle, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Debugging() {
  return (
    <TutorialLayout
      title="Conflict Detection"
      description="Turn 2am EADDRINUSE nightmares into 5-second diagnoses. Learn to use Port Daddy's registry to find, identify, and resolve infrastructure collisions."
      number={5}
      total={20}
      level="Intermediate"
      readTime="14 min read"
      prev={{ title: 'Monorepo Mastery', href: '/tutorials/monorepo' }}
      next={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <AlertTriangle className="text-[var(--status-error)]" size={20} />
            </div>
            <h2 className="m-0">The Horror Story</h2>
          </div>
          <p>
            It's 2am. You're deploying a hotfix. The staging server won't start. Your terminal screams in red: <code>Error: listen EADDRINUSE: address already in use :::3100</code>. In the old world, you'd reach for <code>lsof</code> and hope for the best.
          </p>

          <CodeBlock language="bash">
            {`$ lsof -i :3100\nCOMMAND   PID   USER   FD   TYPE   DEVICE   NAME\nnode    48291  erich   23u  IPv6   0x1a2b   *:3100`}
          </CodeBlock>

          <p className="text-[var(--text-secondary)] italic text-sm">
            Great. You have a PID. But what service is it? Why did it start? And is it safe to kill?
          </p>
        </section>

        {/* Step 1: Identification */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Search className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Identify the Squatter</h2>
          </div>

          <p>
            When every service claims its port through Port Daddy, you get a complete <strong>Semantic Registry</strong>. The <code>find</code> command tells you exactly who owns the port.
          </p>

          <CodeBlock language="bash">
            {`$ pd find :3100\n\n✓ Match Found:\n  - Identity:  payment-stack:api:main\n  - PID:       48291\n  - Started:   2 hours ago\n  - Status:    Healthy (200 OK)`}
          </CodeBlock>

          <div className="space-y-3 pt-2">
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Activity size={14} className="inline text-[var(--brand-secondary)] mr-1" />
              <strong>Live Health</strong> -- Port Daddy checks if the process is actually responding, not just squatting on the socket.
            </p>
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Shield size={14} className="inline text-[var(--brand-secondary)] mr-1" />
              <strong>Owner Track</strong> -- See exactly which agent or harbor created the claim to avoid accidental kills.
            </p>
          </div>
        </section>

        {/* Step 2: Resolution */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Zap className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Heal the Harbor</h2>
          </div>

          <p>
            If a process is "zombie" (the agent died but the process didn't), use <code>pd release</code>. The daemon will attempt a graceful shutdown before forcefully reclaiming the port.
          </p>

          <CodeBlock language="bash">
            {`$ pd release :3100 --force\n\n✓ Sending SIGTERM to PID 48291...\n✓ Process terminated.\n✓ Port 3100 is now free for reclamation.`}
          </CodeBlock>

          <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Advanced Diagnostics</p>
          <CodeBlock language="bash">{`$ pd health --all`}</CodeBlock>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
              <span>myapp:api</span>
              <span className="text-[var(--status-success)]">HEALTHY</span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span>myapp:worker</span>
              <span className="text-[var(--status-error)] font-bold">UNHEALTHY (Connection Refused)</span>
            </div>
          </div>
        </section>

        {/* Support CTA */}
        <section className="p-6 text-center space-y-4">
          <p className="text-lg max-w-xl mx-auto text-[var(--text-secondary)]">
            The CLI manual contains detailed error codes and recovery patterns for every possible infrastructure collision.
          </p>
          <Link to="/docs" className="no-underline">
            <button
              className="px-8 py-3 rounded-xl text-[var(--text-inverse)] font-black text-sm inline-flex items-center gap-2 transition-all"
              style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-sm)' }}
            >
              VIEW SDK MANUAL
              <ChevronRight size={16} />
            </button>
          </Link>
        </section>
      </div>
    </TutorialLayout>
  )
}
