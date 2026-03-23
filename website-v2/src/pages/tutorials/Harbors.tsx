import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Shield, Lock, Key, Zap, ShieldCheck, AlertTriangle } from 'lucide-react'

export function Harbors() {
  return (
    <TutorialLayout
      title="Harbors (Advisory)"
      description="Define permission namespaces for agent teams. Harbors record intent and enable discovery, but enforcement is advisory in the current version."
      number="03"
      total="14"
      level="Advanced"
      readTime="12 min read"
      prev={{ title: 'Multi-Agent Flow', href: '/tutorials/multi-agent' }}
      next={{ title: 'Agent Spawning', href: '/tutorials/always-on' }}
    >
      <motion.div className="space-y-16">
        {/* Advisory Notice */}
        <blockquote className="bg-[var(--bg-surface)] p-10 rounded-[32px] border-l-8 border-[var(--p-amber-500)]">
           <motion.div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={24} className="text-[var(--p-amber-400)]" />
              <motion.p className="font-bold text-[var(--text-primary)] m-0 text-xl font-display">Advisory Enforcement</motion.p>
           </motion.div>
           <motion.p className="m-0 text-base">
             Harbor enforcement is advisory in the current version. Harbors record intent and enable discovery, but the daemon does not block operations based on harbor capabilities. Agents can still make any API call regardless of their harbor assignment. Full enforcement is planned for a future release.
           </motion.p>
        </blockquote>

        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Shield className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Why Harbors Exist</motion.h2>
          </motion.div>
          <motion.p>
            When you run multiple AI agents on the same project, you need a way to express which agents should have access to what. Harbors are named permission namespaces that let you declare capabilities for groups of agents.
          </motion.p>
          <motion.p>
            In the current version, harbors record this intent -- they issue HMAC-signed tokens and track which agents belong to which namespace. This enables discovery ("who else is working in this harbor?") and audit trails. Capability enforcement at the daemon level is planned but not yet implemented.
          </motion.p>
        </section>

        {/* Step 1: Creation */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <Lock className="text-[var(--p-amber-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Create a Harbor</motion.h2>
          </motion.div>

          <motion.p>
            Create a harbor named <code>security-review</code> with specific capabilities and a TTL. The capabilities are recorded for documentation and future enforcement.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor create my-swarm:security-review \\
    --cap "code:read,notes:write" \\
    --ttl 2h`}
          </CodeBlock>

          <motion.div className="grid sm:grid-cols-2 gap-6">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="teal">Capability: code:read</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Declares that agents in this harbor intend to read source files. Currently advisory.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-4">
                <Badge variant="amber">Capability: notes:write</Badge>
                <motion.p className="text-sm opacity-60 m-0 leading-relaxed text-[var(--text-secondary)]">Declares that agents in this harbor intend to write session notes. Currently advisory.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 2: Entrance */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Key className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Enter the Harbor</motion.h2>
          </motion.div>

          <motion.p>
            When an agent enters a harbor, Port Daddy issues a Harbor Card -- an HMAC-signed JWT that encodes the agent's identity, its declared capabilities, and the expiration time.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd harbor enter my-swarm:security-review

Harbor: my-swarm:security-review
Token:  eyJhbGciOiJIUzI1NiJ9...
Caps:   code:read, notes:write
Expires: 2h from now`}
          </CodeBlock>

          <motion.p className="opacity-60 italic text-sm">
            Tokens expire automatically after the TTL. You can also revoke early with <code>pd harbor leave</code>.
          </motion.p>
        </section>

        {/* Implementation Detail */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--brand-primary)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <ShieldCheck size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Implementation Detail</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>HMAC-SHA256 Signing</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Harbor Cards are standard JWTs signed with HMAC-SHA256 using a per-daemon secret key. The daemon generates this key on first run and stores it in the SQLite database. Each token's JTI (unique identifier) is tracked for revocation.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-primary)]">
              <Zap size={14} className="animate-pulse" />
              Advisory Mode -- Enforcement Planned
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
