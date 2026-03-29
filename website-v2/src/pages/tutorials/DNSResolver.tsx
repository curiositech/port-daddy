import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Search, Zap, Shield, Network, Anchor, Activity } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function DNSResolver() {
  return (
    <TutorialLayout
      title="Identity Discovery"
      description="Stop memorizing port numbers. Learn to use Port Daddy's internal DNS to resolve services by their semantic identities across your entire mesh."
      number={9}
      total={16}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Visual Control Plane', href: '/tutorials/dashboard' }}
      next={{ title: 'Agent Inbox', href: '/tutorials/inbox' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Globe className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Beyond Localhost</motion.h2>
          </motion.div>
          <motion.p>
            In a swarm, services are dynamic. They move between ports, containers, and harbors. <strong>Identity Discovery</strong> allows your agents to find services using stable, semantic names (like <code>auth.pd.local</code>) instead of fragile, hardcoded port numbers.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Zap size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Zero Config</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Port Daddy automatically updates your system hosts file or provides a local DNS server.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Anchor size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Semantic Mapping</motion.h3>
                <motion.p className="text-sm text-[var(--text-secondary)] m-0">Map <code>project:stack:identity</code> strings directly to reachable network addresses.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Registration */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Network className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Register a Name</motion.h2>
          </motion.div>

          <motion.p>
            When you claim an identity, Port Daddy can automatically register a corresponding <code>.pd.local</code> hostname.
          </motion.p>

          <CodeBlock language="bash">
            {`$ pd claim my-swarm:api --dns auth.pd.local\n\n✓ Port 3102 assigned.\n✓ DNS Registered: http://auth.pd.local -> localhost:3102`}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              The daemon handles the complexity of OS-level DNS resolution, ensuring your browser and local tools can resolve these names instantly.
            </p>
          </Surface>
        </section>

        {/* Step 2: Resolution */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Search className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Discovery in Code</motion.h2>
          </motion.div>

          <motion.p>
            Agents can query the daemon to resolve identities to current network addresses. This is pivotal for LangChain tools that need to call dynamic APIs.
          </motion.p>

          <CodeBlock language="bash">
            {`# Resolve an identity to an address\n$ pd dns lookup my-swarm:api\n\nlocalhost:3102`}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-secondary)]/5 to-[var(--brand-secondary)]/5" />
             <motion.p className="text-sm font-black uppercase tracking-widest text-[var(--text-muted)] m-0 relative z-10">Real-time Resolution</motion.p>
             <motion.div className="space-y-4 relative z-10">
                <Surface depth="inset" radius="2xl" padding="none" className="p-4 flex items-center justify-between">
                   <motion.div className="flex items-center gap-4">
                      <motion.span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Identity</motion.span>
                      <code className="text-xs font-bold text-[var(--brand-primary)]">swarm:db:primary</code>
                   </motion.div>
                   <motion.div className="flex items-center gap-4">
                      <motion.span className="text-[10px] font-black uppercase text-[var(--text-muted)]">Resolved</motion.span>
                      <code className="text-xs font-bold">127.0.0.1:5432</code>
                   </motion.div>
                </Surface>
             </motion.div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.03] pointer-events-none">
              <Activity size={400} />
           </motion.div>
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Discovery Maturity</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>Identity is Address.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             In Port Daddy v3.7, we've decoupled address from identity. Your agents no longer "search" for services--they declare an intent to communicate, and the daemon handles the routing.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
              <Shield size={14} className="animate-pulse" />
              Local DNS Resolution
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
