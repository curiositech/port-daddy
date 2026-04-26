import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Layout, Activity, Zap, Terminal, Share2 } from 'lucide-react'

export function Dashboard() {
  return (
    <TutorialLayout
      title="Live Dashboard"
      description="Coordination is hard to visualize in a terminal. The Port Daddy dashboard gives you real-time panels for services, agents, sessions, locks, and system health."
      number={14}
      total={20}
      level="Beginner"
      readTime="5 min read"
      prev={{ title: 'Harbor Tokens (Advisory)', href: '/tutorials/harbors' }}
      next={{ title: 'Activity Log Inspection', href: '/tutorials/time-travel' }}
    >
      <div className="space-y-12">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Layout className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">The Dashboard</h2>
          </div>
          <p>
            The <strong>Port Daddy Dashboard</strong> is a single-page web UI served directly by the daemon. It gives you real-time panels showing services, agents, sessions, locks, messaging, DNS, activity, salvage queue, and system health -- all auto-refreshing.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Share2 size={18} className="text-[var(--brand-secondary)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>15 Live Panels</strong> -- Services, Agents, Sessions, Locks, Messaging, DNS, Activity, Salvage, Integration, Briefing, Sugar Context, Ports, Projects, Health, and Notes.</p>
            </div>
            <div className="flex items-start gap-3">
              <Activity size={18} className="text-[var(--brand-accent)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>SSE Real-Time Updates</strong> -- The dashboard subscribes to Server-Sent Events at <code>/dashboard/events</code> for live updates without polling.</p>
            </div>
          </div>
        </section>

        {/* Step 1: Launching */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Zap className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Open the Dashboard</h2>
          </div>

          <p>
            The dashboard is served automatically by the daemon. Just open the daemon URL in your browser -- no separate command needed.
          </p>

          <CodeBlock language="bash">
            {`# The daemon runs on port 9876 by default\nopen http://localhost:9876\n\n# Or check the status to see the URL\n$ pd status\nPort Daddy daemon is running on http://localhost:9876`}
          </CodeBlock>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            The dashboard uses <strong>Server-Sent Events</strong> for real-time updates. New port claims, session notes, and agent heartbeats appear on your screen within milliseconds.
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
            The dashboard isn't just for observation. You can inspect lock contention, view session note timelines, and monitor agent heartbeats directly from the interface.
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
             Multi-agent coordination is often a "black box." The dashboard turns that box transparent, allowing you to debug complex social dynamics between agents just as easily as you debug code.
           </p>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
