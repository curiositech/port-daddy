import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Shield, Terminal, Network, Anchor, Cpu, Sparkles } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function RemoteHarbors() {
  return (
    <TutorialLayout
      title="Multiplayer Localhost"
      description="The swarm doesn't stop at your machine. Learn to link Port Daddy daemons across the global mesh to coordinate with remote agent clusters and GPU-powered harbors."
      number={18}
      total={20}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: 'Swarm Observation', href: '/tutorials/watch' }}
      next={{ title: 'Fleet: Background Agents', href: '/tutorials/fleet' }}
    >
      <div className="space-y-12">
        {/* Coming in v4 Banner */}
        <p className="m-0 text-sm border-l-4 border-[var(--brand-accent)] pl-4" style={{ color: 'var(--text-secondary)' }}>
          <Badge variant="gold" className="px-3 py-0.5 text-[10px] font-black uppercase tracking-widest mr-2">Coming in v4</Badge>
          Remote Harbors are a <strong>planned feature</strong> for Port Daddy v4. None of the commands on this page exist yet. This tutorial describes the design vision and planned syntax for cross-machine agent coordination. Today, Port Daddy runs as a single-machine daemon on localhost:9876.
        </p>

        {/* Intro Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Globe className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">The Vision: Multi-Machine Coordination</h2>
          </div>
          <p>
            <strong>Remote Harbors</strong> will allow you to treat agents running on different machines -- whether a teammate's laptop or a cloud GPU cluster -- as part of a single coordinated swarm. This is the next major evolution of Port Daddy's architecture.
          </p>
          <div className="space-y-3 pt-2">
            <div className="flex items-start gap-3">
              <Anchor size={18} className="text-[var(--brand-secondary)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>Cross-Machine Sync</strong> -- Planned: discovery nodes that negotiate secure, encrypted handshakes between daemons behind firewalls.</p>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles size={18} className="text-[var(--brand-accent)] mt-0.5 shrink-0" />
              <p className="m-0 text-sm"><strong>Compute Routing</strong> -- Planned: route intensive agent tasks to remote harbors with more powerful hardware.</p>
            </div>
          </div>
        </section>

        {/* Step 1: Discovery */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Network className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Planned: Connect Instances</h2>
          </div>

          <p>
            The design calls for a <code>harbor discover</code> command to find available remote lighthouses or join a private mesh using a secure invitation. This command does not exist yet.
          </p>

          <CodeBlock language="bash">
            {`# PLANNED SYNTAX — not yet implemented
$ pd harbor discover --lighthouse global.portdaddy.dev \\
    --invite pd-inv-7f3a-9921

# Expected output (v4):
# ✓ Identity Verified.
# ✓ Linked to remote harbor: gpu-swarm-01
# ✓ Latency: 42ms (Secure P2P)`}
          </CodeBlock>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            The design calls for end-to-end encrypted communication between daemon instances. Today, you can expose a local service externally using <code>pd tunnel</code> with ngrok or cloudflared, but cross-daemon coordination is not yet available.
          </p>
        </section>

        {/* What exists today */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
              <Terminal className="text-[var(--brand-accent)]" size={20} />
            </div>
            <h2 className="m-0">2. What Works Today</h2>
          </div>

          <p>
            While remote harbors are planned, Port Daddy already has building blocks for external access:
          </p>

          <CodeBlock language="bash">
            {`# Expose a local service via tunnel (works today)
pd tunnel myapp:api start --provider ngrok

# Local DNS for service discovery (works today)
pd dns create myapp-api.local --port 3000

# Pub/sub messaging between local agents (works today)
pd pub deploy:events "build-complete"
pd watch deploy:events --exec ./notify.sh`}
          </CodeBlock>

          <div className="flex items-center justify-center gap-8 py-4">
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 flex items-center justify-center rounded-full" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
                <Terminal size={20} className="text-[var(--brand-secondary)]" />
              </div>
              <span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Local Dev</span>
            </div>
            <div className="flex-1 max-w-[80px] h-[2px] opacity-40" style={{ background: 'var(--brand-accent)' }} />
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-raised)' }}>
              <Globe size={24} className="text-[var(--text-inverse)]" />
            </div>
            <div className="flex-1 max-w-[80px] h-[2px] opacity-40" style={{ background: 'var(--brand-accent)' }} />
            <div className="flex flex-col items-center gap-2">
              <div className="w-12 h-12 flex items-center justify-center rounded-full" style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}>
                <Cpu size={20} className="text-[var(--brand-accent)]" />
              </div>
              <span className="text-[10px] font-black uppercase text-[var(--text-muted)]">GPU Cluster (v4)</span>
            </div>
          </div>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-6 text-center space-y-4 relative overflow-hidden">
           <Badge variant="gold" className="px-4 py-1 text-[10px] font-black uppercase tracking-widest">Coming in v4</Badge>
           <p className="text-lg font-bold m-0" style={{ color: 'var(--text-primary)' }}>Global Intelligence.</p>
           <p className="max-w-xl mx-auto opacity-70 m-0">
             Port Daddy v4 will extend the daemon model across machines, enabling agents to cooperate across any network. Today, all coordination happens through your local daemon on localhost:9876. Remote harbors will bring the same primitives -- ports, sessions, pub/sub, salvage -- to a distributed mesh.
           </p>
           <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} />
              Planned for v4
           </div>
        </Surface>
      </div>
    </TutorialLayout>
  )
}
