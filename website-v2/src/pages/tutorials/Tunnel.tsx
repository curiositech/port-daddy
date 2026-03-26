import { motion } from 'framer-motion'
import { TutorialLayout } from '@/components/tutorials/TutorialLayout'
import { CodeBlock } from '@/components/ui/CodeBlock'
import { Badge } from '@/components/ui/Badge'
import { Globe, Zap, Share2, Terminal, Activity } from 'lucide-react'

export function Tunnel() {
  return (
    <TutorialLayout
      title="Tunnels"
      description="Expose local services to the internet instantly. Port Daddy wraps ngrok, cloudflared, and localtunnel to create public URLs for any claimed service."
      number="05"
      total="14"
      level="Beginner"
      readTime="6 min read"
      prev={{ title: 'Agent Spawning', href: '/tutorials/always-on' }}
      next={{ title: 'Activity Log', href: '/tutorials/time-travel' }}
    >
      <motion.div className="space-y-16">
        {/* Concept Section */}
        <section className="space-y-6">
          <motion.div className="flex items-center gap-4 mb-8">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Globe className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Public URLs for Local Services</motion.h2>
          </motion.div>
          <motion.p>
            Port Daddy's tunnel system wraps popular tunnel providers (ngrok, cloudflared, localtunnel) to expose your locally-claimed services to the internet. It manages the tunnel lifecycle alongside your port claims -- start a tunnel, share the URL, stop it when done.
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
                   <Lock size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Provider Agnostic</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Works with whichever tunnel provider you have installed. Port Daddy detects available providers automatically.</motion.p>
             </motion.div>
             <motion.div
               className="p-8 rounded-2xl space-y-4"
               style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
             >
                <motion.div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Network size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Lifecycle Managed</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Tunnels are tied to your port claims. The daemon tracks active tunnels and can clean them up on shutdown.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Check providers */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Share2 className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Check Available Providers</motion.h2>
          </motion.div>

          <motion.p>
            First, check which tunnel providers are installed on your system.
          </motion.p>

          <CodeBlock language="bash">
            {`$ curl http://localhost:9876/tunnel/providers

          <blockquote
            className="p-8 rounded-2xl border-l-4 border-[var(--brand-primary)]"
            style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
          >
             <motion.p className="m-0 text-sm italic opacity-60 font-medium">
               Port Daddy uses a distributed network of **Lighthouses** to negotiate P2P connections, even behind restrictive NAT or corporate firewalls.
             </motion.p>
          </blockquote>
        </section>

        {/* Step 2: Start a tunnel */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
            >
              <Zap className="text-[var(--p-teal-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Start a Tunnel</motion.h2>
          </motion.div>

          <motion.p>
            Start a tunnel for any service that has a claimed port. The provider wraps your local port in a public URL.
          </motion.p>

          <CodeBlock language="bash">
            {'# Start a tunnel using ngrok for a claimed service\n$ curl -X POST http://localhost:9876/tunnel/myapp:api \\\n    -H "Content-Type: application/json" \\\n    -d \'{"provider": "ngrok"}\'\n\n# Response:\n# { "url": "https://abc123.ngrok.io", "provider": "ngrok", "port": 3102 }\n\n# Check tunnel status\n$ curl http://localhost:9876/tunnel/myapp:api\n\n# List all active tunnels\n$ curl http://localhost:9876/tunnels\n\n# Stop a tunnel\n$ curl -X DELETE http://localhost:9876/tunnel/myapp:api'}
          </CodeBlock>

          <motion.div
            className="p-10 rounded-2xl space-y-6 relative overflow-hidden"
            style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          >
             <motion.div className="absolute inset-0 bg-gradient-to-r from-[var(--p-blue-500)]/5 to-[var(--p-teal-500)]/5" />
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">The Mesh Visualization</motion.p>
             <motion.div className="flex items-center justify-between gap-10 relative z-10">
                <motion.div
                  className="flex-1 p-6 rounded-2xl text-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Badge variant="teal" className="mb-2">Local Harbor</Badge>
                   <motion.p className="text-xs opacity-60 m-0">Agent 'A'</motion.p>
                </motion.div>
                <motion.div className="flex-1 flex flex-col items-center">
                   <motion.div className="h-[1px] w-full opacity-40" style={{ background: 'var(--brand-accent)' }} />
                   <motion.span className="text-[8px] font-black uppercase tracking-widest opacity-40 mt-2">Noise Tunnel</motion.span>
                </motion.div>
                <motion.div
                  className="flex-1 p-6 rounded-2xl text-center"
                  style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                >
                   <Badge variant="amber" className="mb-2">Remote Harbor</Badge>
                   <motion.p className="text-xs opacity-60 m-0">Agent 'B'</motion.p>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Security Callout */}
        <motion.div
          className="p-16 rounded-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          whileHover={{ scale: 1.01 }}
        >
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Simple Wrappers</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>No Magic. Just Plumbing.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Unlike standard VPNs, Port Daddy tunnels are **per-identity**. You don't expose your entire network--only the specific semantic identities you've explicitly claimed in your harbor.
           </motion.p>
           <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--p-blue-400)]">
              <Activity size={14} className="animate-pulse" />
              Provider Detection Active
           </motion.div>
        </motion.div>
      </motion.div>
    </TutorialLayout>
  )
}
