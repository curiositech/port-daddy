import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import { Globe, Zap, Share2, Activity, Network, Lock as LockIcon } from 'lucide-react'

export function Tunnel() {
  return (
    <TutorialLayout
      title="Tunnels"
      description="Expose local services to the internet instantly. Port Daddy wraps ngrok, cloudflared, and localtunnel to create public URLs for any claimed service."
      number="05"
      total={14}
      level="Beginner"
      readTime="6 min read"
      prev={{ title: 'Agent Spawning', href: '/tutorials/always-on' }}
      next={{ title: 'Activity Log', href: '/tutorials/time-travel' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Globe className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">Public URLs for Local Services</motion.h2>
          </motion.div>
          <motion.p>
            Port Daddy's tunnel system wraps popular tunnel providers (ngrok, cloudflared, localtunnel) to expose your locally-claimed services to the internet. It manages the tunnel lifecycle alongside your port claims -- start a tunnel, share the URL, stop it when done.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <LockIcon size={20} className="text-[var(--brand-secondary)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Provider Agnostic</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Works with whichever tunnel provider you have installed. Port Daddy detects available providers automatically.</motion.p>
             </Surface>
             <Surface depth="raised" radius="2xl" className="p-8 space-y-4">
                <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center">
                   <Network size={20} className="text-[var(--brand-accent)]" />
                </Surface>
                <motion.h3 className="text-xl font-display font-black m-0">Lifecycle Managed</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Tunnels are tied to your port claims. The daemon tracks active tunnels and can clean them up on shutdown.</motion.p>
             </Surface>
          </motion.div>
        </section>

        {/* Step 1: Check providers */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Share2 className="text-[var(--brand-primary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">1. Check Available Providers</motion.h2>
          </motion.div>

          <motion.p>
            First, check which tunnel providers are installed on your system.
          </motion.p>

          <CodeBlock language="bash">
            {'$ curl http://localhost:9876/tunnel/providers\n\n# Returns list of available providers (ngrok, cloudflare, localtunnel)'}
          </CodeBlock>

          <Surface depth="flat" radius="xl" padding="md" className="border-l-4 border-[var(--brand-secondary)]">
            <p className="m-0 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Port Daddy uses a distributed network of <strong>Lighthouses</strong> to negotiate P2P connections, even behind restrictive NAT or corporate firewalls.
            </p>
          </Surface>
        </section>

        {/* Step 2: Start a tunnel */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
              <Zap className="text-[var(--brand-secondary)]" size={24} />
            </Surface>
            <motion.h2 className="m-0">2. Start a Tunnel</motion.h2>
          </motion.div>

          <motion.p>
            Start a tunnel for any service that has a claimed port. The provider wraps your local port in a public URL.
          </motion.p>

          <CodeBlock language="bash">
            {'# Start a tunnel using ngrok for a claimed service\n$ curl -X POST http://localhost:9876/tunnel/myapp:api \\\n    -H "Content-Type: application/json" \\\n    -d \'{"provider": "ngrok"}\'\n\n# Response:\n# { "url": "https://abc123.ngrok.io", "provider": "ngrok", "port": 3102 }\n\n# Check tunnel status\n$ curl http://localhost:9876/tunnel/myapp:api\n\n# List all active tunnels\n$ curl http://localhost:9876/tunnels\n\n# Stop a tunnel\n$ curl -X DELETE http://localhost:9876/tunnel/myapp:api'}
          </CodeBlock>

          <Surface depth="raised" radius="2xl" className="p-10 space-y-6 relative overflow-hidden">
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-secondary)]/5 to-[var(--brand-secondary)]/5" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">The Mesh Visualization</motion.p>
             <motion.div className="flex items-center justify-between gap-10 relative z-10">
                <Surface depth="inset" radius="2xl" padding="none" className="flex-1 p-6 text-center">
                   <Badge variant="teal" className="mb-2">Local Harbor</Badge>
                   <motion.p className="text-xs opacity-60 m-0">Agent 'A'</motion.p>
                </Surface>
                <motion.div className="flex-1 flex flex-col items-center">
                   <motion.div className="h-[1px] w-full opacity-40" style={{ background: 'var(--brand-accent)' }} />
                   <motion.span className="text-[8px] font-black uppercase tracking-widest opacity-40 mt-2">Noise Tunnel</motion.span>
                </motion.div>
                <Surface depth="inset" radius="2xl" padding="none" className="flex-1 p-6 text-center">
                   <Badge variant="gold" className="mb-2">Remote Harbor</Badge>
                   <motion.p className="text-xs opacity-60 m-0">Agent 'B'</motion.p>
                </Surface>
             </motion.div>
          </Surface>
        </section>

        {/* Security Callout */}
        <Surface depth="raised" radius="2xl" className="p-16 flex flex-col items-center text-center gap-8 relative overflow-hidden">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Simple Wrappers</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>No Magic. Just Plumbing.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Unlike standard VPNs, Port Daddy tunnels are <strong>per-identity</strong>. You don't expose your entire network--only the specific semantic identities you've explicitly claimed in your harbor.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-secondary)]">
              <Activity size={14} className="animate-pulse" />
              Provider Detection Active
           </motion.div>
        </Surface>
      </motion.div>
    </TutorialLayout>
  )
}
