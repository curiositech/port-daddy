import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Terminal, Shield, Zap, History, Anchor, Globe, MessageSquare, Copy, Check, Rocket, Mail, RefreshCw, Download,  Search, Cpu, Layers } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'
import { Activity } from 'lucide-react'

/* --- Data ----------------------------------------------------------------- */

const INSTALL_STEPS = [
  {
    title: 'Install the Daemon',
    description: 'Port Daddy requires the local control plane. Install it via Homebrew or npm.',
    icon: Download,
    code: 'brew install erichowens/tap/port-daddy'
  },
  {
    title: 'Initialize MCP',
    description: 'One command to register the protocol handler and generate your credentials.',
    icon: Terminal,
    code: 'pd mcp install'
  },
  {
    title: 'Agent Handshake',
    description: 'Open Claude or Cursor. Your agents will automatically detect the new capabilities.',
    icon: Rocket,
    code: 'pd start'
  }
]

const ESSENTIAL_TOOLS = [
  {
    name: 'begin_session',
    description: 'The agent entry point. Registers identity, starts a work venture, and claims initial files in one atomic handshake.',
    icon: Rocket,
    color: 'var(--brand-primary)',
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
    color: 'var(--brand-accent)',
    example: `const { port } = await claim_port({
  identity: "myapp:api:main"
})
// → Port 3102`,
  },
  {
    name: 'add_note',
    description: 'The immutable swarm ledger. Leave timestamped context for other agents or the human harbormaster.',
    icon: MessageSquare,
    color: 'var(--brand-primary)',
    example: `await add_note({
  content: "Middleware updated. JWT shape changed.",
  type: "decision"
})`,
  },
  {
    name: 'check_salvage',
    description: 'Self-healing discovery. Identify work escrowed from dead or crashed agents in your harbor.',
    icon: RefreshCw,
    color: 'var(--brand-secondary)',
    example: `const { pending } = await check_salvage({
  identity_prefix: "myapp"
})`,
  }
]

const CATEGORIES = [
  { id: 'ports', label: 'Atomic Ports', icon: Anchor, count: 8 },
  { id: 'security', label: 'Cryptographic Harbors', icon: Shield, count: 12 },
  { id: 'radio', label: 'Swarm Radio', icon: Zap, count: 6 },
  { id: 'inbox', label: 'Agent Inboxes', icon: Mail, count: 5 },
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
      className="p-12 rounded-2xl space-y-10 group transition-all relative overflow-hidden flex flex-col items-center text-center"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      whileHover={{ y: -8 }}
    >
       <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
          <tool.icon size={160} />
       </div>

       <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div
            className="w-20 h-20 rounded-2xl flex items-center justify-center"
            style={{ background: `${tool.color}10`, boxShadow: 'var(--shadow-inset)' }}
          >
             <tool.icon size={40} style={{ color: tool.color }} />
          </motion.div>
          <div className="space-y-2 flex flex-col items-center">
             <code className="text-2xl font-black font-mono" style={{ color: tool.color }}>{tool.name}</code>
             <span
               className="inline-block px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-lg"
               style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)', color: 'var(--brand-primary)' }}
             >Essential Primitive</span>
          </div>
       </div>

       <motion.p className="text-xl leading-relaxed text-text-secondary m-0 relative z-10 font-bold max-w-sm">
          {tool.description}
       </motion.p>

       <motion.div
         className="w-full relative p-10 font-mono text-sm overflow-hidden transition-colors text-left rounded-2xl"
         style={{ background: 'var(--code-bg)', boxShadow: 'var(--shadow-inset)', borderRadius: 'var(--radius-lg)' }}
       >
          <div className="flex items-start justify-between gap-8">
             <pre className="opacity-60 m-0 leading-relaxed overflow-x-auto whitespace-pre-wrap" style={{ color: 'var(--code-text)' }}>{tool.example}</pre>
             <button onClick={handleCopy} className="shrink-0 text-[var(--brand-primary)] opacity-40 hover:opacity-100 transition-opacity pt-1">
                {copied ? <Check size={20} /> : <Copy size={20} />}
             </button>
          </div>
       </motion.div>
    </motion.div>
  )
}

export default function McpPage() {
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
      className="min-h-screen flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >

      
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 z-[100] origin-left"
        style={{ scaleX, top: 'var(--nav-height)', background: 'var(--brand-primary)', boxShadow: '0 0 12px rgba(58,173,173,0.5)' }}
      />

      {/* Hero Section */}
      <motion.section
        className="py-20 px-6 sm:px-8 lg:px-10 relative overflow-hidden flex flex-col items-center justify-center text-center"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[800px] h-[800px] rounded-full blur-[160px] opacity-[0.1] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-8">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em]">Model Context Protocol</Badge>
           <motion.h1
             className="text-4xl sm:text-6xl font-black tracking-tighter font-display leading-[0.85] m-0 text-[var(--text-primary)]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Context is <br />
             <span className="text-brand-primary">Coordination.</span>
           </motion.h1>
           <motion.p
             className="text-xl sm:text-2xl max-w-4xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             One install command to give your agents the coordination infrastructure they deserve. 60+ production-grade tools for the modern swarm.
           </motion.p>

           <div className="flex flex-col items-center gap-8 pt-12 w-full">
              <motion.div
                className="inline-flex flex-col sm:flex-row items-center gap-6 px-12 py-8 rounded-2xl font-mono text-xl relative overflow-hidden group"
                style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                whileHover={{ scale: 1.02 }}
              >
                 <div className="absolute inset-0 bg-gradient-to-r from-[var(--brand-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                 <div className="flex items-center gap-4 relative z-10">
                    <Terminal size={32} className="text-[var(--brand-primary)]" />
                    <span className="font-black tracking-tight text-[var(--text-primary)]">pd mcp install</span>
                 </div>
                 <div className="h-8 w-[1px] hidden sm:block relative z-10" style={{ background: 'var(--text-muted)' }} />
                 <motion.span className="text-xs font-black uppercase tracking-widest text-[var(--text-muted)] relative z-10">One Handshake</motion.span>
              </motion.div>
              <motion.p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-muted)] m-0">Supports Claude Code, Cursor, and Continue.dev</motion.p>
           </div>
        </div>
      </motion.section>

      {/* Installation Guide */}
      <section className="py-24 bg-bg-surface border-b border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col items-center">
           <div className="text-center mb-20 space-y-6">
              <Badge variant="default" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-bg-overlay border border-border-strong text-text-primary">Getting Started</Badge>
              <h2 className="text-4xl sm:text-6xl font-display font-black text-text-primary tracking-tighter">Instant Integration.</h2>
           </div>

           <div className="grid md:grid-cols-3 gap-12 w-full">
              {INSTALL_STEPS.map((step, i) => (
                <motion.div 
                  key={step.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  viewport={{ once: true }}
                  className="p-10 rounded-[48px] bg-bg-base border border-border-subtle flex flex-col gap-8 group hover:border-brand-primary transition-all shadow-lg"
                >
                   <div className="w-14 h-14 rounded-2xl bg-bg-overlay border border-border-subtle flex items-center justify-center group-hover:scale-110 transition-transform">
                      <step.icon size={28} className="text-brand-primary" />
                   </div>
                   <div className="space-y-4">
                      <h3 className="text-2xl font-display font-black text-text-primary">{step.title}</h3>
                      <p className="text-text-secondary leading-relaxed font-bold">{step.description}</p>
                   </div>
                   <div className="mt-auto p-6 rounded-2xl bg-bg-overlay border border-border-subtle font-mono text-xs text-brand-primary font-black overflow-x-auto whitespace-nowrap">
                      $ {step.code}
                   </div>
                </motion.div>
              ))}
           </div>
        </div>
      </section>

      {/* Main Content */}
      <motion.main className="flex-1 py-20 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">

        {/* Progressive Disclosure */}
        <section className="mb-32 space-y-20 w-full flex flex-col items-center">
           <div className="flex flex-col items-center text-center gap-8 pb-20 w-full max-w-4xl">
              <Badge variant="default" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Agent Experience (AX)</Badge>
              <div className="flex flex-col items-center gap-8">
                 <motion.div
                   className="w-20 h-20 rounded-2xl flex items-center justify-center"
                   style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                 >
                    <Layers size={40} className="text-[var(--p-teal-400)]" />
                 </motion.div>
                 <motion.h2 className="text-4xl sm:text-6xl font-display font-black tracking-tighter m-0 leading-[0.95] text-[var(--text-primary)]">Progressive Disclosure.</motion.h2>
              </div>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] m-0 font-medium max-w-3xl mx-auto">
                 Agents shouldn't be overwhelmed by complexity. Port Daddy exposes <strong>8 essential tools</strong> by default. Call <code>pd_discover()</code> to unlock advanced categories as the task requires.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
              {CATEGORIES.map((cat, i) => (
                <motion.div
                  key={cat.id}
                  className="p-10 rounded-2xl space-y-8 group transition-all text-center flex flex-col items-center"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                >
                   <div className="flex flex-col items-center gap-6">
                      <motion.div
                        className="w-16 h-16 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"
                        style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                      >
                         <cat.icon size={32} className="text-[var(--brand-primary)] opacity-40 group-hover:opacity-100 transition-opacity" />
                      </motion.div>
                      <span
                        className="inline-block px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-lg text-[var(--text-muted)]"
                        style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                      >{cat.count} Tools</span>
                   </div>
                   <motion.h3 className="m-0 text-2xl font-display font-black leading-tight text-text-primary">{cat.label}</motion.h3>
                </motion.div>
              ))}
           </div>
        </section>

        {/* Essential 8 Tools */}
        <section className="space-y-20 w-full flex flex-col items-center">
           <div className="flex flex-col items-center text-center gap-8 pb-20 w-full max-w-4xl">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">The Standard Library</Badge>
              <div className="flex flex-col items-center gap-8">
                 <motion.div
                   className="w-20 h-20 rounded-2xl flex items-center justify-center"
                   style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                 >
                    <Zap size={40} className="text-[var(--brand-primary)]" />
                 </motion.div>
                 <motion.h2 className="text-4xl sm:text-6xl font-display font-black tracking-tighter m-0 leading-[0.95] text-[var(--text-primary)]">The Essential Set.</motion.h2>
              </div>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] m-0 font-medium max-w-3xl mx-auto">
                 The primitives every agent needs to be a productive member of the swarm. Optimized for context window efficiency and sub-50ms latency.
              </motion.p>
           </div>

           <div className="grid lg:grid-cols-2 gap-12 w-full">
              {ESSENTIAL_TOOLS.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
           </div>
        </section>

        {/* Vision Callout */}
        <motion.div
          className="mt-32 p-24 rounded-2xl flex flex-col items-center text-center gap-8 relative overflow-hidden w-full mx-auto"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Cpu size={800} />
           </div>

           <div className="space-y-10 max-w-4xl relative z-10 flex flex-col items-center">
              <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-widest">Model Optimization</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black tracking-tight leading-[0.95] m-0 text-[var(--text-primary)]">
                Built for <br />
                <span className="text-[var(--p-teal-400)]">Intelligence.</span>
              </motion.h3>
              <motion.p className="text-xl sm:text-2xl leading-relaxed text-[var(--text-secondary)] max-w-3xl mx-auto">
                The Port Daddy MCP server isn't just a collection of APIs. It's a structured ontology designed to teach your models how to coordinate. We use precise descriptions and high-fidelity examples to ensure the model chooses the right primitive every time.
              </motion.p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-6xl relative z-10">
              {[
                { label: 'Token Efficient', icon: Zap },
                { label: 'Latency Aware', icon: Activity },
                { label: 'Auto-Discovery', icon: Search },
                { label: 'Secure Handshake', icon: Shield }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-10 rounded-2xl flex flex-col items-center gap-6 group transition-all"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                   <motion.div
                     className="w-14 h-14 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                   >
                      <item.icon size={28} className="text-[var(--brand-primary)]" />
                   </motion.div>
                   <motion.span className="text-[10px] font-black uppercase tracking-[0.25em] text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors text-center">{item.label}</motion.span>
                </motion.div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
