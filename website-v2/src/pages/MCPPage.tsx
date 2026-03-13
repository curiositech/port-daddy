import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Terminal, Shield, Zap, History, Anchor, Search, Cpu, Globe, Share2, ArrowRight, MessageSquare, Box, Lock, Activity, BookOpen, ChevronRight, Copy, Check, Info, Rocket, Heart, Layers, Mail, Send, RefreshCw } from 'lucide-react'
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
      className="p-10 rounded-[56px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-10 group hover:border-[var(--border-strong)] transition-all shadow-2xl relative overflow-hidden"
      whileHover={{ y: -8 }}
    >
       <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
          <tool.icon size={120} />
       </div>

       <div className="flex items-center gap-6 relative z-10">
          <div 
            className="w-16 h-16 rounded-[24px] flex items-center justify-center border shadow-lg"
            style={{ background: `${tool.color}10`, borderColor: `${tool.color}20` }}
          >
             <tool.icon size={32} style={{ color: tool.color }} />
          </div>
          <div className="space-y-1">
             <code className="text-xl font-black font-mono" style={{ color: tool.color }}>{tool.name}</code>
             <Badge variant="teal" className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5">Essential</Badge>
          </div>
       </div>

       <p className="text-xl leading-relaxed opacity-70 m-0 relative z-10 font-medium max-w-sm">
          {tool.description}
       </p>
       
       <div className="relative rounded-[32px] bg-[var(--bg-overlay)] p-8 font-mono text-xs overflow-hidden group-hover:bg-[var(--interactive-active)] transition-colors border border-[var(--border-subtle)]">
          <div className="flex items-start justify-between gap-6">
             <pre className="opacity-60 m-0 leading-relaxed overflow-x-auto whitespace-pre-wrap">{tool.example}</pre>
             <button onClick={handleCopy} className="shrink-0 text-[var(--brand-primary)] opacity-40 hover:opacity-100 transition-opacity pt-1">
                {copied ? <Check size={16} /> : <Copy size={16} />}
             </button>
          </div>
       </div>
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
      <motion.section className="py-32 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-7xl mx-auto text-center relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Model Context Protocol</Badge>
           <motion.h1 
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Context is <span className="text-[var(--brand-primary)]">Coordination.</span>
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed opacity-70 font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             60+ production-grade tools across 17 categories. One install command to give your agents the infrastructure they deserve.
           </motion.p>

           <div className="flex flex-col items-center gap-6 pt-10">
              <div className="inline-flex items-center gap-4 px-10 py-6 rounded-full bg-[var(--bg-overlay)] border border-[var(--border-strong)] font-mono text-lg shadow-2xl">
                 <Terminal size={24} className="text-[var(--brand-primary)]" />
                 <span className="font-bold">pd mcp install</span>
                 <div className="h-6 w-[1px] bg-[var(--border-strong)]" />
                 <span className="text-xs font-black uppercase tracking-widest opacity-40">One Command</span>
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] opacity-40">Supports Claude Code, Cursor, and Continue.dev</p>
           </div>
        </div>
      </motion.section>

      {/* Main Content */}
      <motion.main className="flex-1 py-32 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        
        {/* Progressive Disclosure */}
        <section className="mb-48 space-y-16">
           <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-[var(--border-subtle)] pb-12">
              <div className="max-w-2xl space-y-6">
                 <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center border shadow-lg bg-[var(--p-teal-500)]/10 border-[var(--p-teal-500)]/20">
                       <Layers size={28} className="text-[var(--p-teal-400)]" />
                    </div>
                    <h2 className="text-4xl sm:text-6xl font-display font-black tracking-tight m-0">Progressive Disclosure.</h2>
                 </div>
                 <p className="text-xl leading-relaxed opacity-60 m-0 font-medium">
                    Agents shouldn't be overwhelmed by complexity. Port Daddy exposes <strong>8 essential tools</strong> by default. Call <code>pd_discover()</code> to unlock advanced categories as the task requires.
                 </p>
              </div>
              <Badge variant="neutral" className="px-4 py-1.5 text-[8px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">Agent Experience (AX)</Badge>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {CATEGORIES.map((cat, i) => (
                <motion.div 
                  key={cat.id}
                  className="p-8 rounded-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-6 group hover:border-[var(--brand-primary)] transition-all"
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                >
                   <div className="flex items-center justify-between">
                      <div className="w-12 h-12 rounded-2xl bg-[var(--bg-overlay)] flex items-center justify-center border border-[var(--border-subtle)] group-hover:scale-110 transition-transform">
                         <cat.icon size={24} className="text-[var(--brand-primary)] opacity-40 group-hover:opacity-100 transition-opacity" />
                      </div>
                      <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest opacity-40">{cat.count} Tools</Badge>
                   </div>
                   <h3 className="m-0 text-xl font-display font-black">{cat.label}</h3>
                </motion.div>
              ))}
           </div>
        </section>

        {/* Essential 8 Tools */}
        <section className="space-y-16">
           <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 border-b border-[var(--border-subtle)] pb-12">
              <div className="max-w-2xl space-y-6">
                 <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center border shadow-lg bg-[var(--brand-primary)]/10 border-[var(--brand-primary)]/20">
                       <Zap size={28} className="text-[var(--brand-primary)]" />
                    </div>
                    <h2 className="text-4xl sm:text-6xl font-display font-black tracking-tight m-0">The Essential Set.</h2>
                 </div>
                 <p className="text-xl leading-relaxed opacity-60 m-0 font-medium">
                    The primitives every agent needs to be a productive member of the swarm. Optimized for context window efficiency and low latency.
                 </p>
              </div>
           </div>

           <div className="grid lg:grid-cols-2 gap-10">
              {ESSENTIAL_TOOLS.map((tool, i) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
           </div>
        </section>

        {/* Vision Callout */}
        <motion.div 
          className="mt-48 p-20 rounded-[80px] border border-dashed border-[var(--brand-primary)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Cpu size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Model Optimization</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                Built for <span className="text-[var(--p-teal-400)]">Intelligence.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                The Port Daddy MCP server isn't just a collection of APIs. It's a structured ontology designed to teach your models how to coordinate. We use precise descriptions and high-fidelity examples to ensure the model chooses the right primitive every time.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
              {[
                { label: 'Sub-50ms Latency', icon: Zap },
                { label: 'Token Efficient', icon: Shield },
                { label: 'Auto-Discovery', icon: Search },
                { label: 'Secure Handshake', icon: Lock }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
