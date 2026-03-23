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
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-blue-400)]">
              <Globe className="text-[var(--p-blue-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">Public URLs for Local Services</motion.h2>
          </motion.div>
          <motion.p>
            Port Daddy's tunnel system wraps popular tunnel providers (ngrok, cloudflared, localtunnel) to expose your locally-claimed services to the internet. It manages the tunnel lifecycle alongside your port claims -- start a tunnel, share the URL, stop it when done.
          </motion.p>
          <motion.div className="grid sm:grid-cols-2 gap-8 pt-4">
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-teal-500)]/10 flex items-center justify-center">
                   <Share2 size={20} className="text-[var(--p-teal-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Provider Agnostic</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Works with whichever tunnel provider you have installed. Port Daddy detects available providers automatically.</motion.p>
             </motion.div>
             <motion.div className="p-8 rounded-[32px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-4">
                <motion.div className="w-10 h-10 rounded-xl bg-[var(--p-amber-500)]/10 flex items-center justify-center">
                   <Terminal size={20} className="text-[var(--p-amber-400)]" />
                </motion.div>
                <motion.h3 className="text-xl font-display font-black m-0">Lifecycle Managed</motion.h3>
                <motion.p className="text-sm opacity-60 m-0">Tunnels are tied to your port claims. The daemon tracks active tunnels and can clean them up on shutdown.</motion.p>
             </motion.div>
          </motion.div>
        </section>

        {/* Step 1: Check providers */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--brand-primary)]">
              <Terminal className="text-[var(--brand-primary)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">1. Check Available Providers</motion.h2>
          </motion.div>

          <motion.p>
            First, check which tunnel providers are installed on your system.
          </motion.p>

          <CodeBlock language="bash">
            {`$ curl http://localhost:9876/tunnel/providers

{
  "ngrok": true,
  "cloudflared": true,
  "localtunnel": false
}`}
          </CodeBlock>
        </section>

        {/* Step 2: Start a tunnel */}
        <section className="space-y-8">
          <motion.div className="flex items-center gap-4">
            <motion.div className="w-12 h-12 rounded-2xl bg-[var(--interactive-active)] flex items-center justify-center border border-[var(--p-teal-400)]">
              <Zap className="text-[var(--p-teal-400)]" size={24} />
            </motion.div>
            <motion.h2 className="m-0">2. Start a Tunnel</motion.h2>
          </motion.div>

          <motion.p>
            Start a tunnel for any service that has a claimed port. The provider wraps your local port in a public URL.
          </motion.p>

          <CodeBlock language="bash">
            {`# Start a tunnel using ngrok for a claimed service
$ curl -X POST http://localhost:9876/tunnel/myapp:api \\
    -H "Content-Type: application/json" \\
    -d '{"provider": "ngrok"}'

{
  "url": "https://abc123.ngrok.io",
  "provider": "ngrok",
  "port": 3102,
  "service": "myapp:api"
}

# Check tunnel status
$ curl http://localhost:9876/tunnel/myapp:api

# List all active tunnels
$ curl http://localhost:9876/tunnels

# Stop a tunnel
$ curl -X DELETE http://localhost:9876/tunnel/myapp:api`}
          </CodeBlock>

          <motion.div className="bg-[var(--bg-surface)] p-10 rounded-[48px] border border-[var(--border-subtle)] space-y-6 relative overflow-hidden shadow-2xl">
             <motion.p className="text-sm font-black uppercase tracking-widest opacity-40 m-0 relative z-10">How It Works</motion.p>
             <motion.div className="flex items-center justify-between gap-10 relative z-10">
                <motion.div className="flex-1 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center">
                   <Badge variant="teal" className="mb-2">Local Service</Badge>
                   <motion.p className="text-xs opacity-60 m-0">localhost:3102</motion.p>
                </motion.div>
                <motion.div className="flex-1 flex flex-col items-center">
                   <motion.div className="h-[1px] w-full bg-dashed border-t border-[var(--brand-primary)] opacity-40" />
                   <motion.span className="text-[8px] font-black uppercase tracking-widest opacity-40 mt-2">ngrok / cloudflared</motion.span>
                </motion.div>
                <motion.div className="flex-1 p-6 rounded-2xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center">
                   <Badge variant="amber" className="mb-2">Public URL</Badge>
                   <motion.p className="text-xs opacity-60 m-0">abc123.ngrok.io</motion.p>
                </motion.div>
             </motion.div>
          </motion.div>
        </section>

        {/* Callout */}
        <motion.div
          className="p-16 rounded-[60px] border border-dashed border-[var(--p-blue-400)] bg-[var(--bg-overlay)] flex flex-col items-center text-center gap-8 relative overflow-hidden"
          whileHover={{ scale: 1.01 }}
        >
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Simple Wrappers</Badge>
           <motion.h3 className="text-4xl font-display font-black m-0" style={{ color: 'var(--text-primary)' }}>No Magic. Just Plumbing.</motion.h3>
           <motion.p className="text-xl max-w-xl opacity-70">
             Port Daddy tunnels are thin wrappers around existing tools. You still need ngrok, cloudflared, or localtunnel installed on your system. Port Daddy just manages the lifecycle alongside your port claims.
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
