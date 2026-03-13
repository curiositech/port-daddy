import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Box, Layers, Zap, Terminal, Globe, Shield, Activity, Anchor } from 'lucide-react'

export function Monorepo() {
  return (
    <TutorialLayout
      title="Fleet Management"
      description="Stop juggling 15 terminal tabs. Learn to scan your entire monorepo, assign ports atomically, and orchestrate a full service mesh with a single command."
      number="03"
      total="16"
      level="Intermediate"
      readTime="10 min read"
      prev={{ title: 'The Swarm Handshake', href: '/tutorials/multi-agent' }}
      next={{ title: 'Conflict Detection', href: '/tutorials/debugging' }}
    >
      <motion.div className="space-y-16">
        {/* Intro Section */}
        <section className="space-y-6">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-amber-400)]">
              <Layers className="text-[var(--p-amber-400)]" size={24} />
            </div>
            <h2 className="m-0">The Monorepo Nightmare</h2>
          </div>
          <p>
            You have fifteen services. Three databases. A search engine. Every developer on your team has a different way of starting the stack, and port conflicts are a daily occurrence. **Fleet Management** turns your monorepo into a unified service mesh.
          </p>
          <div className="grid sm:grid-cols-2 gap-8 pt-4">
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--p-teal-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Zero-Config DNS</h3>
                <p className="text-sm opacity-60 m-0">Services find each other via semantic names instead of hardcoded <code>localhost:3001</code> URLs.</p>
             </div>
             <div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--p-blue-500)]/10 flex items-center justify-center">
                   <Anchor size={20} className="text-[var(--p-blue-400)]" />
                </div>
                <h3 className="text-xl font-display font-black m-0">Atomic Assignment</h3>
                <p className="text-sm opacity-60 m-0">Ports are hashed from directory paths, ensuring the same service always gets the same port.</p>
             </div>
          </div>
        </section>

        {/* Step 1: Scanning */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Box className="text-[var(--brand-primary)]" size={24} />
            </div>
            <h2 className="m-0">1. Index the Fleet</h2>
          </div>
          
          <p>
            Use the <code>scan</code> command to let Port Daddy auto-detect every service in your project. It supports over 60 frameworks out of the box.
          </p>

          <CodeBlock language="bash">
            {`$ pd scan ./services\n\n✓ Found 12 services in 1.4s\n  - services/auth (Next.js)\n  - services/api (Express)\n  - services/worker (Go)`}
          </CodeBlock>

          <blockquote className="bg-[var(--bg-overlay)] p-8 rounded-3xl border-l-4 border-[var(--brand-primary)]">
             <p className="m-0 text-sm italic opacity-60 font-medium">
               Port Daddy creates a local SQLite registry of your services, allowing agents to query the fleet status at any time.
             </p>
          </blockquote>
        </section>

        {/* Step 2: Launching */}
        <section className="space-y-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Activity className="text-[var(--p-teal-400)]" size={24} />
            </div>
            <h2 className="m-0">2. Bring the Stack Up</h2>
          </div>

          <p>
            The <code>pd up</code> command launches your services in dependency order, assigning atomic ports and wiring up the internal DNS.
          </p>

          <CodeBlock language="bash">
            {`$ pd up\n\n[payment-stack] Starting 12 services...\n✓ [auth]   Started on port 3101\n✓ [api]    Started on port 3102\n✓ [worker] Started on port 3103\n\nMesh health: 100% (All services responding)`}
          </CodeBlock>

          <div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6 relative overflow-hidden shadow-2xl">
             <div className="absolute inset-0 bg-gradient-to-r from-[var(--p-teal-500)]/5 to-[var(--p-blue-500)]/5" />
             <p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">Internal Service Mesh</p>
             <div className="flex flex-col gap-4 relative z-10">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <div className="flex items-center gap-4">
                      <code className="text-xs text-[var(--brand-primary)]">auth.pd.local</code>
                      <ArrowRight size={14} className="opacity-20" />
                      <code className="text-xs opacity-60">localhost:3101</code>
                   </div>
                   <Badge variant="teal">Healthy</Badge>
                </div>
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                   <div className="flex items-center gap-4">
                      <code className="text-xs text-[var(--brand-primary)]">api.pd.local</code>
                      <ArrowRight size={14} className="opacity-20" />
                      <code className="text-xs opacity-60">localhost:3102</code>
                   </div>
                   <Badge variant="teal">Healthy</Badge>
                </div>
             </div>
          </div>
        </section>

        {/* Resilience Callout */}
        <motion.div 
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-amber-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Globe size={400} />
           </div>
           <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Orchestration Maturity</Badge>
           <h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Unified Mesh.</h3>
           <p className="text-xl max-w-xl opacity-70">
             Fleet management isn't just about starting scripts—it's about building a **shared environment**. When your frontend agent needs the API, it doesn't search for a port. It asks the Port Daddy mesh for the API identity.
           </p>
           <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-amber-400)]">
              <Shield size={14} className="animate-pulse" />
              Service Mesh Active
           </div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
