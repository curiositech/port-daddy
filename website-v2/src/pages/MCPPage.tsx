import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Terminal, Shield, Zap, History, Anchor, Search, Cpu, Globe, MessageSquare, Lock, Copy, Check, Rocket, Layers, Mail, RefreshCw } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

/* ─── Data ─────────────────────────────────────────────────────────────────── */

const ESSENTIAL_TOOLS = [
  {
    name: 'begin_session',
    description: 'The agent entry point. Registers identity, starts a work venture, and claims initial files in one atomic handshake.',
    icon: Rocket,
    color: 'var(--p-teal-400)',
    example: `await begin_session({
  purpose: "Refactoring the auth middleware",
  identity: "myapp:api:auth",
  files: ["src/middleware/auth.ts"]
})`,
  },
  {
    name: 'claim_port',
    description: 'Deterministic port assignment. Ensures semantic identities always map to the same port across restarts.',
    icon: Anchor,
    color: 'var(--p-blue-400)',
    example: `const { port } = await claim_port({
  identity: "myapp:api:main"
})
// → Port 3102 (Always assigned to this identity)`,
  },
  {
    name: 'add_note',
    description: 'The immutable swarm ledger. Leave timestamped context for other agents or the human harbormaster.',
    icon: MessageSquare,
    color: 'var(--p-amber-400)',
    example: `await add_note({
  content: "Middleware updated. JWT shape changed.",
  type: "decision"
})`,
  },
  {
    name: 'check_salvage',
    description: 'Self-healing discovery. Identify work escrowed from dead or crashed agents in your harbor.',
    icon: RefreshCw,
    color: 'var(--p-purple-400)',
    example: `const { pending } = await check_salvage({
  identity_prefix: "myapp"
})`,
  }
]

const CATEGORIES = [
  { id: 'ports', label: 'Atomic Ports', icon: Anchor, color: 'var(--p-blue-400)', count: 8 },
  { id: 'security', label: 'Cryptographic Harbors', icon: Shield, color: 'var(--p-teal-400)', count: 12 },
  { id: 'radio', label: 'Swarm Radio', icon: Zap, color: 'var(--p-amber-400)', count: 6 },
  { id: 'inbox', label: 'Agent Inboxes', icon: Mail, color: 'var(--p-purple-400)', count: 5 },
  { id: 'mesh', label: 'Global Mesh', icon: Globe, count: 9 },
  { id: 'audit', label: 'Immutable Audit', icon: History, count: 7 }
]

function ToolCard({ tool }: { tool: any }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(tool.example)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div 
      className="p-12 rounded-[64px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-10 group hover:border-[var(--border-strong)] transition-all shadow-2xl relative overflow-hidden flex flex-col items-center text-center"
      whileHover={{ y: -8 }}
    >
       <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
          <tool.icon size={160} />
       </div>

       <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div 
            className="w-20 h-20 rounded-[32px] flex items-center justify-center border shadow-lg"
            style={{ background: `${tool.color}10`, borderColor: `${tool.color}20` }}
          >
             <tool.icon size={40} style={{ color: tool.color }} />
          </motion.div>
          <div className="space-y-2 flex flex-col items-center">
             <code className="text-2xl font-black font-mono" style={{ color: tool.color }}>{tool.name}</code>
             <Badge variant="teal" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest shadow-sm">Essential Primitive</Badge>
          </div>
       </div>

       <motion.p className="text-xl leading-relaxed opacity-70 m-0 relative z-10 font-medium max-w-sm">
          {tool.description}
       </motion.p>
       
       <motion.div className="w-full relative rounded-[40px] bg-[var(--bg-overlay)] p-10 font-mono text-sm overflow-hidden group-hover:bg-[var(--interactive-active)] transition-colors border border-[var(--border-subtle)] text-left">
          <div className="flex items-start justify-between gap-8">
             <pre className="opacity-60 m-0 leading-relaxed overflow-x-auto whitespace-pre-wrap">{tool.example}</pre>
             <button onClick={handleCopy} className="shrink-0 text-[var(--brand-primary)] opacity-40 hover:opacity-100 transition-opacity pt-1">
                {copied ? <Check size={20} /> : <Copy size={20} />}
             </button>
          </div>
       </motion.div>
    </motion.div>
  )
}

export default function MCPPage() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  })

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-[var(--brand-primary)] z-[100] origin-left shadow-[0_0_12px_rgba(58,173,173,0.5)]"
        style={{ scaleX, top: 'var(--nav-height)' }}
      />

      {/* Hero Section */}
      <motion.section 
        className="py-48 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden flex flex-col items-center justify-center text-center" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-12">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Model Context Protocol</Badge>
           <motion.h1 
             className="text-7xl sm:text-9xl font-black tracking-tighter font-display leading-[0.85] m-0"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Context is <br />
             <span className="text-[var(--brand-primary)]">Coordination.</span>
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-4xl max-w-4xl leading-relaxed opacity-70 font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             60+ production-grade tools across 17 categories. One install command to give your agents the infrastructure they deserve.
           </motion.p>

           <div className="flex flex-col items-center gap-8 pt-12 w-full">
              <motion.div 
                className="inline-flex flex-col sm:flex-row items-center gap-6 px-12 py-8 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-strong)] font-mono text-xl shadow-2xl relative overflow-hidden group"
                whileHover={{ scale: 1.02 }}
              >
                 <div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                 <div className="flex items-center gap-4 relative z-10">
                    <Terminal size={32} className="text-[var(--brand-primary)]" />
                    <span className="font-black tracking-tight">pd mcp install</span>
                 </div>
                 <div className="h-8 w-[1px] bg-[var(--border-strong)] hidden sm:block relative z-10" />
                 <motion.span className="text-xs font-black uppercase tracking-widest opacity-40 relative z-10">One Handshake</motion.span>
              </motion.div>
              <motion.p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30 m-0">Supports Claude Code, Cursor, and Continue.dev</motion.p>
           </div>
        </div>
      </motion.section>

      {/* Main Content */}
      <motion.main className="flex-1 py-48 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        
        {/* Progressive Disclosure */}
        <section className="mb-64 space-y-24 w-full flex flex-col items-center">
           <div className="flex flex-col items-center text-center gap-10 border-b border-[var(--border-subtle)] pb-20 w-full max-w-4xl">
              <Badge variant="neutral" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-md">Agent Experience (AX)</Badge>
              <div className="flex flex-col items-center gap-8">
                 <motion.div className="w-20 h-20 rounded-3xl flex items-center justify-center border shadow-2xl bg-[var(--p-teal-500)]/10 border-[var(--p-teal-500)]/20">
                    <Layers size={40} className="text-[var(--p-teal-400)]" />
                 </motion.div>
                 <motion.h2 className="text-5xl sm:text-8xl font-display font-black tracking-tighter m-0 leading-[0.95]">Progressive Disclosure.</motion.h2>
              </div>
              <motion.p className="text-2xl leading-relaxed opacity-70 m-0 font-medium max-w-3xl mx-auto">
                 Agents shouldn't be overwhelmed by complexity. Port Daddy exposes <strong>8 essential tools</strong> by default. Call <code>pd_discover()</code> to unlock advanced categories as the task requires.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12 w-full">
              {CATEGORIES.map((cat, i) => (
                <motion.div 
                  key={cat.id}
                  className="p-10 rounded-[56px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-8 group hover:border-[var(--brand-primary)] transition-all text-center flex flex-col items-center shadow-xl"
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                >
                   <div className="flex flex-col items-center gap-6">
                      <motion.div className="w-16 h-16 rounded-[24px] bg-[var(--bg-overlay)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform shadow-inner">
                         <cat.icon size={32} className="text-[var(--brand-primary)] opacity-40 group-hover:opacity-100 transition-opacity" />
                      </motion.div>
                      <Badge variant="neutral" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest opacity-40 shadow-sm">{cat.count} Tools</Badge>
                   </div>
                   <motion.h3 className="m-0 text-2xl font-display font-black leading-tight">{cat.label}</motion.h3>
                </motion.div>
              ))}
           </div>
        </section>

        {/* Essential 8 Tools */}
        <section className="space-y-24 w-full flex flex-col items-center">
           <div className="flex flex-col items-center text-center gap-10 border-b border-[var(--border-subtle)] pb-20 w-full max-w-4xl">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-md">The Standard Library</Badge>
              <div className="flex flex-col items-center gap-8">
                 <motion.div className="w-20 h-20 rounded-3xl flex items-center justify-center border shadow-2xl bg-[var(--brand-primary)]/10 border-[var(--brand-primary)]/20">
                    <Zap size={40} className="text-[var(--brand-primary)]" />
                 </div>
                 <motion.h2 className="text-5xl sm:text-8xl font-display font-black tracking-tighter m-0 leading-[0.95]">The Essential Set.</motion.h2>
              </div>
              <motion.p className="text-2xl leading-relaxed opacity-70 m-0 font-medium max-w-3xl mx-auto">
                 The primitives every agent needs to be a productive member of the swarm. Optimized for context window efficiency and sub-50ms latency.
              </motion.p>
           </div>

           <div className="grid lg:grid-cols-2 gap-16 w-full">
              {ESSENTIAL_TOOLS.map((tool, i) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
           </div>
        </section>

        {/* Vision Callout */}
        <motion.div 
          className="mt-64 p-24 rounded-[100px] border border-dashed border-[var(--brand-primary)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-16 relative overflow-hidden w-full shadow-2xl"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Cpu size={800} />
           </div>
           
           <div className="space-y-10 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest shadow-2xl">Model Optimization</Badge>
              <motion.h3 className="text-5xl sm:text-8xl font-display font-black tracking-tight leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                Built for <br />
                <span className="text-[var(--p-teal-400)]">Intelligence.</span>
              </motion.h3>
              <motion.p className="text-2xl sm:text-3xl leading-relaxed opacity-70 max-w-3xl mx-auto">
                The Port Daddy MCP server isn't just a collection of APIs. It's a structured ontology designed to teach your models how to coordinate. We use precise descriptions and high-fidelity examples to ensure the model chooses the right primitive every time.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 w-full max-w-6xl relative z-10">
              {[
                { label: 'Token Efficient', icon: Zap },
                { label: 'Latency Aware', icon: Activity },
                { label: 'Auto-Discovery', icon: Search },
                { label: 'Secure Handshake', icon: Lock }
              ].map((item, i) => (
                <motion.div key={i} className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-6 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <motion.div className="w-14 h-14 rounded-2xl bg-[var(--bg-surface)] flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] opacity-40 group-hover:opacity-100 transition-opacity text-center">{item.label}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}

import { Activity } from 'lucide-react'
