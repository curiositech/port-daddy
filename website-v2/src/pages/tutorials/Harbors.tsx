import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Shield, Lock, Key, Zap, ShieldCheck } from 'lucide-react'

export function Harbors() {
  return (
    <TutorialLayout
      title="Cryptographic Harbors"
      description="Modern AI requires more than just ports. Learn to define secure permission namespaces and issue HMAC-signed capability tokens to your swarms."
      number="03"
      total="16"
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Multi-Agent Flow', href: '/tutorials/multi-agent' }}
      next={{ title: 'Always-On Avatars', href: '/tutorials/always-on' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Shield className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">The Security Pivot</motion.h2>
          </motion.div>
          <motion.p>
            Standard multi-agent frameworks often run with the full permissions of the host user. This is a massive security risk. **Harbors** are Port Daddy's solution: named workspaces that enforce strict capability boundaries.
          </motion.p>
          <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-teal-500)]">
             <motion.p className="font-bold text-[var(--text-primary)] m-0 mb-4 text-2xl font-display">Soundness by Design:</motion.p>
             <motion.p className="m-0 text-lg">
               In Port Daddy v3.7, every harbor operation is verified against a mathematical state machine. If an agent tries to claim a port it doesn't own, the daemon rejects the request instantly.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 1: Creation */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <Lock className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Define the Boundary</motion.h2>
          </motion.div>
          
          <motion.p>
            Create a harbor named <code>security-review</code>. We will grant it the ability to read code and write notes, but nothing else.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor create my-swarm:security-review \\
    --cap "code:read,notes:write" \\
    --ttl 2h`}
          </CodeBlock>

          <motion.div className="grid sm:grid-cols-2 gap-6">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="teal">Capability: code:read</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Allows the agent to use <code>pd session files claim</code> to access source files.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="amber">Capability: notes:write</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Allows the agent to post status updates to the global session timeline.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 2: Entrance */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Key className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Enter & Authenticate</motion.h2>
          </motion.div>

          <motion.p>
            When an agent enters a harbor, the daemon issues a unique **Harbor Card**—an HMAC-signed JWT that proves the agent's identity and permissions.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor enter my-swarm:security-review\n\n✓ Verification Successful.\n✓ Harbor Card Issued: eyJhbGciOiJIUzI1NiJ9...`}
          </CodeBlock>

          <motion.p className="opacity-60 italic text-sm">
            This token is ephemeral. It will expire in exactly 2 hours, automatically revoking all system access for the agent.
          </motion.p>
        </section>

        {/* The Formal Verification Note */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <ShieldCheck size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Formal Verification</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Verified Handshakes.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             The Harbor entry protocol has been formally verified using <strong>ProVerif</strong>. We've mathematically proven that unauthorized agents cannot "spoof" a harbor card or escalate their capabilities.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Anchor Protocol v4 Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
