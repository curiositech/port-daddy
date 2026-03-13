import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Shield, Zap, Terminal, Share2, Network, Lock, Activity } from 'lucide-react'

export function Tunnel() {
  return (
    <TutorialLayout
      title="P2P Tunnels"
      description="Modern agents don't just live on one machine. Learn to link two Port Daddy daemons across the internet to create a secure, shared service mesh for your swarms."
      number="05"
      total="16"
      level="Advanced"
      readTime="20 min read"
      prev={{ title: 'Always-On Avatars', href: '/tutorials/always-on' }}
      next={{ title: 'Time-Travel Debugging', href: '/tutorials/time-travel' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Globe className="text-[var(--p-blue-400)]" size={24} />
            </div>
            <h2 className="m-0">The Global Harbor</h2>
          </div>
          <p>
            Port Daddy's tunneling system isn't just about public URLs. It's a full **P2P Service Mesh**. By linking two daemons, your local agents can discover and coordination with remote agents as if they were on the same loopback interface.
          </p>
          <div className="grid sm:grid-cols-2 gap-8 pt-4">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Lock size={20} className="text-[var(--p-teal-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Noise Protocol</h3>
                <p className="text-sm opacity-60 m-0">Every tunnel is end-to-end encrypted using the Noise Protocol (Noise_XX), ensuring zero eavesdropping.</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <Network size={20} className="text-[var(--p-amber-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Identity Mesh</h3>
                <p className="text-sm opacity-60 m-0">Remote services are resolved via their semantic identities. <code>pd dns resolve</code> works globally.</p>
             </div>
          </div>
        </section>

        {/* Step 1: Connecting */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Share2 className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">1. Link the Daemons</h2>
          </div>
          
          <p>
            On the host machine, generate a lighthouse invitation. On the client machine, use that invitation to establish the tunnel.
          </p>

          <CodeBlock language="bash">
            {`# Host: Generate invitation\n$ pd tunnel invite\n✓ Invitation generated: pd-inv-7f3a-9921\n\n# Client: Connect to host\n$ pd tunnel connect pd-inv-7f3a-9921\n✓ Secure P2P Tunnel Established.`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--brand-primary)]">
             <p className="m-0 text-sm italic opacity-60 font-medium">
               Port Daddy uses a distributed network of **Lighthouses** to negotiate P2P connections, even behind restrictive NAT or corporate firewalls.
             </p>
          </blockquote>
        </section>

        {/* Step 2: Global Discovery */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Zap className="text-[var(--p-teal-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Cross-Harbor Calls</h2>
          </div>

          <p>
            Once connected, your agents can use standard <code>pd claim</code> and <code>pd pub</code> commands. The daemon automatically routes traffic across the tunnel based on the semantic identity.
          </p>

          <CodeBlock language="bash">
            {`# On Client: Call a service running on the Host\ncurl http://$(pd dns resolve host-swarm:api)/status\n\n# On Host: Publish a signal to the Client\npd pub client-swarm:events "deploy-starting"`}
          </CodeBlock>

          <div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6 relative overflow-hidden shadow-2xl">
             <div className="absolute inset-0 bg-gradient-to-r from-[var(--p-blue-500)]/5 to-[var(--p-teal-500)]/5" />
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">The Mesh Visualization</p>
             <div className="flex items-center justify-between gap-10 relative z-10">
                <div className="flex-1 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center">
                   <Badge variant="teal" className="mb-2">Local Harbor</Badge>
                   <p className="text-xs opacity-60 m-0">Agent 'A'</p>
                </div>
                <div className="flex-1 flex flex-col items-center">
                   <div className="h-[1px] w-full bg-dashed border-t border-[var(--brand-primary)] opacity-40" />
                   <span className="text-[8px] font-black uppercase tracking-widest opacity-40 mt-2">Noise Tunnel</span>
                </div>
                <div className="flex-1 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center">
                   <Badge variant="amber" className="mb-2">Remote Harbor</Badge>
                   <p className="text-xs opacity-60 m-0">Agent 'B'</p>
                </div>
             </div>
          </div>
        </section>

        {/* Security Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-blue-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Shield size={400} />
           </div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Privacy Engineering</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Zero-Trust Mesh.</h3>
           <p className="text-xl max-w-xl opacity-70">
             Unlike standard VPNs, Port Daddy tunnels are **per-identity**. You don't expose your entire network—only the specific semantic identities you've explicitly claimed in your harbor.
           </p>
           <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-blue-400)]">
              <Activity size={14} className="animate-pulse" />
              Anchor Protocol v4 Verified
           </div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
