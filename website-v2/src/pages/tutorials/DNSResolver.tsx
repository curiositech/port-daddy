import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Globe, Search, Zap, Shield, Network, Anchor } from 'lucide-react'
import { Surface } from '@/components/ui/Surface'

export function DNSResolver() {
  return (
    <TutorialLayout
      title="Identity Discovery"
      description="Stop memorizing port numbers. Learn to use Port Daddy's internal DNS to resolve services by their semantic identities across your entire mesh."
      number={7}
      total={19}
      level="Intermediate"
      readTime="8 min read"
      prev={{ title: 'Tunnels', href: '/tutorials/tunnel' }}
      next={{ title: 'Session Phases', href: '/tutorials/session-phases' }}
    >
      <div className="space-y-12">
        {/* Concept Section */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Globe className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">Beyond Localhost</h2>
          </div>
          <p>
            In a swarm, services are dynamic. They move between ports, containers, and harbors. <strong>Identity Discovery</strong> allows your agents to find services using stable, semantic names (like <code>auth.pd.local</code>) instead of fragile, hardcoded port numbers.
          </p>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Zap size={14} className="inline text-[var(--brand-secondary)] mr-1" />
              <strong>Zero Config</strong> -- Port Daddy automatically updates your system hosts file or provides a local DNS server.
            </p>
            <p className="text-sm text-[var(--text-secondary)] m-0">
              <Anchor size={14} className="inline text-[var(--brand-secondary)] mr-1" />
              <strong>Semantic Mapping</strong> -- Map <code>project:stack:identity</code> strings directly to reachable network addresses.
            </p>
          </div>
        </section>

        {/* Step 1: Registration */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Network className="text-[var(--brand-primary)]" size={20} />
            </div>
            <h2 className="m-0">1. Register a Name</h2>
          </div>

          <p>
            First claim a port for your service, then register a DNS hostname that points to it.
          </p>

          <CodeBlock language="bash">
            {`# Step 1: Claim a port for your service\n$ pd claim my-swarm:api\n\n✓ Port 3102 assigned to my-swarm:api\n\n# Step 2: Register a DNS hostname\n$ pd dns register --hostname auth.pd.local --port 3102 --service my-swarm:api\n\n✓ DNS Registered: auth.pd.local -> localhost:3102`}
          </CodeBlock>

          <p className="m-0 text-sm border-l-4 border-[var(--brand-secondary)] pl-4" style={{ color: 'var(--text-secondary)' }}>
            The daemon manages DNS records in SQLite. Use <code>pd dns list</code> to see all registered hostnames and <code>pd dns cleanup</code> to remove stale entries.
          </p>
        </section>

        {/* Step 2: Resolution */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[var(--surface-inset)]">
              <Search className="text-[var(--brand-secondary)]" size={20} />
            </div>
            <h2 className="m-0">2. Discovery in Code</h2>
          </div>

          <p>
            Agents can query the daemon to resolve identities to current network addresses. This is pivotal for LangChain tools that need to call dynamic APIs.
          </p>

          <CodeBlock language="bash">
            {`# Resolve a hostname to a port\n$ pd dns lookup auth.pd.local\n\nlocalhost:3102\n\n# List all registered DNS records\n$ pd dns list\n\n# Check DNS system status\n$ pd dns status`}
          </CodeBlock>

          <Surface depth="inset" radius="xl" className="p-5 space-y-3">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] m-0">Real-time Resolution</p>
            <div className="flex items-center justify-between text-xs font-mono">
              <span>
                <span className="text-[10px] font-black uppercase text-[var(--text-muted)] mr-2">Identity</span>
                <code className="font-bold text-[var(--brand-primary)]">swarm:db:primary</code>
              </span>
              <span>
                <span className="text-[10px] font-black uppercase text-[var(--text-muted)] mr-2">Resolved</span>
                <code className="font-bold">127.0.0.1:5432</code>
              </span>
            </div>
          </Surface>
        </section>

        {/* Vision Callout */}
        <section className="p-6 text-center space-y-4">
          <p className="text-lg max-w-xl mx-auto opacity-70">
            Port Daddy decouples address from identity. Your agents no longer hardcode port numbers -- they register semantic hostnames, and the daemon handles the resolution.
          </p>
          <div className="flex items-center justify-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
            <Shield size={14} />
            Local DNS Resolution
          </div>
        </section>
      </div>
    </TutorialLayout>
  )
}
