import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Layout, Activity, Zap, Terminal, Share2 } from 'lucide-react'

export function Dashboard() {
  return (
    <TutorialLayout
      title="Visual Control Plane"
      description="Coordination is hard to visualize in a terminal. Learn to use the Port Daddy HUD to monitor network graphs, lock contention, and real-time swarm telemetry."
      number={8}
      total={16}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: 'Activity Log', href: '/tutorials/time-travel' }}
      next={{ title: 'Identity Discovery', href: '/tutorials/dns' }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Layout className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">The Swarm HUD</h2>
          </div>
          <p>
            The <strong>Port Daddy Dashboard</strong> (Heads-Up Display) provides a high-fidelity visual interface for your local daemon. It allows you to see the relationships between your agents, services, and harbors in real-time.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Share2 size={18} className="text-[var(--brand-secondary)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>Live Network Map</strong> -- A 2D force-directed graph showing which agents are connected to which harbors and tunnels.</p>
            </div>
            <div className="flex items-start gap-3">
              <Activity size={18} className="text-[var(--brand-accent)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>Swarm Radio Feed</strong> -- A unified chronological stream of every message, port claim, and session note across the mesh.</p>
            </div>
          </div>
        </section>

        {/* Step 1: Launching */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Zap className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Summon the HUD</h2>
          </div>

          <p>
            Launch the dashboard from your terminal. It runs as a local web app served directly from the daemon.
          </p>

          <CodeBlock language="bash">
            {`$ pd dashboard\n\n✓ Dashboard active at http://localhost:3144/dashboard`}
          </CodeBlock>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            The dashboard uses <strong>WebSockets</strong> to ensure that any signal published to Swarm Radio appears on your screen with sub-50ms latency.
          </p>
        </section>

        {/* Step 2: Interaction */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Terminal className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Real-time Intervention</h2>
          </div>

          <p>
            The HUD isn't just for observation. You can manually eject rogue agents, clear stale port claims, and trigger pipeline rules directly from the interface.
          </p>

          <Surface depth="raised" radius="2xl" className="p-5 space-y-4 relative overflow-hidden">
             <p className="text-[10px] font-black uppercase tracking-widest opacity-40 m-0">Visual Telemetry</p>

             <div className="space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="p-4 space-y-3">
                   <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Lock Status</span>
                      <Badge variant="gold">Contested</Badge>
                   </div>
                   <p className="text-xs font-bold m-0">db-migration-lock</p>
                   <div
                     className="h-1 w-full rounded-full overflow-hidden"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                   >
                      <div className="h-full bg-[var(--brand-accent)] w-2/5" />
                   </div>
                </Surface>
                <Surface depth="inset" radius="xl" padding="none" className="p-4 space-y-3">
                   <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Radio Traffic</span>
                      <Badge variant="teal">High</Badge>
                   </div>
                   <div className="flex items-end gap-1 h-6">
                      {[1,2,3,4,5,6].map(i => (
                        <div
                          key={i}
                          className="flex-1 bg-[var(--brand-primary)] rounded-t-sm"
                          style={{ height: [10, 24, 15, 20, 10, 18][i-1] }}
                        />
                      ))}
                   </div>
                </Surface>
             </div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-4 relative overflow-hidden">
           <Badge variant="teal" className="px-4 py-1 text-[10px] font-black uppercase tracking-widest">Visual Maturity</Badge>
           <p className="text-lg font-bold m-0" style={{ color: 'var(--text-primary)' }}>See Your Swarm.</p>
           <p className="max-w-xl mx-auto text-[var(--text-secondary)] m-0">
             Multi-agent coordination is often a "black box." The HUD turns that box transparent, allowing you to debug complex social dynamics between agents just as easily as you debug code.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
