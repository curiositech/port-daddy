import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Shield, Terminal, Network, Anchor, Cpu, Activity, Sparkles } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function RemoteHarbors() {
  return (
    <TutorialLayout
      title="Multiplayer Localhost"
      description="The swarm doesn't stop at your machine. Learn to link Port Daddy daemons across the global mesh to coordinate with remote agent clusters and GPU-powered harbors."
      number={16}
      total={16}
      level="Advanced"
      readTime="15 min read"
      prev={{ title: 'The Session State Machine', href: '/tutorials/session-phases' }}
    >
      <motion.div className="space-y-16">
        {/* Coming in v4 Banner */}
        <Surface depth="flat" radius="2xl" padding="md" className="border-l-4 border-[var(--brand-accent)]">
          <div className="flex items-center gap-3 mb-2">
            <Badge variant="gold" className="px-4 py-1 text-[10px] font-black uppercase tracking-widest">Coming in v4</Badge>
          </div>
          <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Remote Harbors are a <strong>planned feature</strong> for Port Daddy v4. None of the commands on this page exist yet. This tutorial describes the design vision and planned syntax for cross-machine agent coordination. Today, Port Daddy runs as a single-machine daemon on localhost:9876.
          </p>
        </Surface>

        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Globe className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">The Vision: Multi-Machine Coordination</motion.h2>
          </motion.div>
          <motion.p>
            <strong>Remote Harbors</strong> will allow you to treat agents running on different machines -- whether a teammate's laptop or a cloud GPU cluster -- as part of a single coordinated swarm. This is the next major evolution of Port Daddy's architecture.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Anchor size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Cross-Machine Sync</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Planned: discovery nodes that negotiate secure, encrypted handshakes between daemons behind firewalls.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Sparkles size={20} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Compute Routing</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Planned: route intensive agent tasks to remote harbors with more powerful hardware.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Discovery */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Network className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Planned: Connect Instances</motion.h2>
          </motion.div>

          <motion.p>
            The design calls for a <code>harbor discover</code> command to find available remote lighthouses or join a private mesh using a secure invitation. This command does not exist yet.
          </motion.p>

          <CodeBlock language="bash">
            {`# PLANNED SYNTAX — not yet implemented
$ pd harbor discover --lighthouse global.portdaddy.dev \\
    --invite pd-inv-7f3a-9921

# Expected output (v4):
# ✓ Identity Verified.
# ✓ Linked to remote harbor: gpu-swarm-01
# ✓ Latency: 42ms (Secure P2P)`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The design calls for end-to-end encrypted communication between daemon instances. Today, you can expose a local service externally using <code>pd tunnel</code> with ngrok or cloudflared, but cross-daemon coordination is not yet available.
            </p>
          </Surface>
        </section>

        {/* What exists today */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Terminal className="text-[var(--brand-accent)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. What Works Today</motion.h2>
          </motion.div>

          <motion.p>
            While remote harbors are planned, Port Daddy already has building blocks for external access:
          </motion.p>

          <CodeBlock language="bash">
            {`# Expose a local service via tunnel (works today)
pd tunnel myapp:api start --provider ngrok

# Local DNS for service discovery (works today)
pd dns create myapp-api.local --port 3000

# Pub/sub messaging between local agents (works today)
pd pub deploy:events "build-complete"
pd watch deploy:events --exec ./notify.sh`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-8 relative overflow-hidden text-center">
             <motion.div className="absolute inset-0 bg-gradient-to-b from-[var(--brand-secondary)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Vision: Global Mesh</motion.p>

             <motion.div className="flex items-center justify-center gap-12 pt-4">
                <motion.div className="flex flex-col items-center gap-4">
                   <Surface depth="inset" radius="full" padding="none" className="w-16 h-16 flex items-center justify-center">
                      <Terminal size={24} className="text-[var(--brand-secondary)]" />
                   </Surface>
                   <motion.span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Local Dev</motion.span>
                </motion.div>
                <motion.div className="flex-1 h-[2px] opacity-40" style={{ background: 'var(--brand-accent)' }} />
                <motion.div
                  className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse"
                  style={{ background: 'var(--brand-primary)', boxShadow: 'var(--shadow-raised)' }}
                >
                   <Globe size={32} className="text-[var(--text-inverse)]" />
                </motion.div>
                <motion.div className="flex-1 h-[2px] opacity-40" style={{ background: 'var(--brand-accent)' }} />
                <motion.div className="flex flex-col items-center gap-4">
                   <Surface depth="inset" radius="full" padding="none" className="w-16 h-16 flex items-center justify-center">
                      <Cpu size={24} className="text-[var(--brand-accent)]" />
                   </Surface>
                   <motion.span className="text-[10px] font-black uppercase text-[var(--text-muted)]">GPU Cluster (v4)</motion.span>
                </motion.div>
             </motion.div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Coming in v4</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Global Intelligence.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Port Daddy v4 will extend the daemon model across machines, enabling agents to cooperate across any network. Today, all coordination happens through your local daemon on localhost:9876. Remote harbors will bring the same primitives -- ports, sessions, pub/sub, salvage -- to a distributed mesh.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Planned for v4
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
