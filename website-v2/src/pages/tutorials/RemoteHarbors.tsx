import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Shield, Terminal, Network, Anchor, Cpu, Activity, Sparkles } from 'lucide-react'

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
        {/* Intro Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Globe className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">The Infinite Swarm</motion.h2>
          </motion.div>
          <motion.p>
            **Remote Harbors** are the final piece of the Port Daddy architecture. They allow you to treat agents running on different machines--whether it's your teammate's laptop or a cloud-hosted GPU cluster--as part of a single, unified swarm.
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
                   <Anchor size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Global Lighthouses</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Public discovery nodes that negotiate secure, encrypted handshakes between daemons behind firewalls.</motion.p>
             </motion.div>
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Sparkles size={20} className="text-[var(--brand-accent)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Compute Routing</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Re-route intensive agent tasks to remote harbors with more powerful hardware seamlessly.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Discovery */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Network className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Summon a Lighthouse</motion.h2>
          </motion.div>

          <motion.p>
            Use the <code>harbor discover</code> command to find available remote lighthouses or join a private mesh using a secure invitation.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor discover --lighthouse global.portdaddy.dev\\
    --invite pd-inv-7f3a-9921\\

✓ Identity Verified.
✓ Linked to remote harbor: gpu-swarm-01
✓ Latency: 42ms (Secure P2P)`}
          </CodeBlock>

          <blockquote
            className="p-8 rounded-2xl border-l-4 border-[var(--brand-primary)]"
            style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
          >
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               In Port Daddy v3.7, all remote communication is strictly end-to-end encrypted using the **Noise Protocol** (Noise_XX). Even the lighthouse cannot see your agent traffic.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Global Calls */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Cpu className="text-[var(--p-purple-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Hailing Remote Agents</motion.h2>
          </motion.div>

          <motion.p>
            Once linked, remote identities appear in your local DNS registry. You can call remote agents or publish to their Swarm Radio channels exactly as if they were local.
          </motion.p>

          <CodeBlock language="bash">
            {`# Call an agent running on the remote GPU cluster\\
curl http://$(pd dns resolve gpu-swarm:vision-analyst)/analyze\\
    -d @image.png\\

# Broadcast a signal to all linked daemons\\
pd pub global:swarm:events "new-task-ready"`}
          </CodeBlock>

          <motion.div
            className="p-10 rounded-2xl space-y-8 relative overflow-hidden text-center"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
             <motion.div className="absolute inset-0 bg-gradient-to-b from-[var(--p-blue-500)]/5 to-transparent" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0">The Global Mesh</motion.p>

             <motion.div className="flex items-center justify-center gap-12 pt-4">
                <motion.div className="flex flex-col items-center gap-4">
                   <motion.div
                     className="w-16 h-16 rounded-full flex items-center justify-center"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                   >
                      <Terminal size={24} className="text-[var(--p-teal-400)]" />
                   </motion.div>
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
                   <motion.div
                     className="w-16 h-16 rounded-full flex items-center justify-center"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                   >
                      <Cpu size={24} className="text-[var(--brand-accent)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase text-[var(--text-muted)]">GPU Cluster</motion.span>
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
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">The Ultimate Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Global Intelligence.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Port Daddy v3.7 isn't just about your machine--it's about the **Mesh**. We're building the infrastructure for a world where agents cooperate across any network, forming vast, secure, and resilient autonomous organizations.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Shield size={14} className="animate-pulse" />
              Anchor Protocol v4 Verified
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
