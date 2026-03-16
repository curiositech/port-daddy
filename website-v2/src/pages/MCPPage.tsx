import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Terminal, Shield, Zap, History, Anchor, Globe, MessageSquare, Copy, Check, Rocket, Mail, RefreshCw, Download } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

/* ─── Data ─────────────────────────────────────────────────────────────────── */

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
      className="p-12 rounded-[64px] bg-bg-surface border border-border-subtle space-y-10 group hover:border-brand-primary transition-all shadow-2xl relative overflow-hidden flex flex-col items-center text-center"
      whileHover={{ y: -8 }}
    >
       <div className="absolute top-0 right-0 p-10 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity">
          <tool.icon size={160} />
       </div>

       <div className="flex flex-col items-center gap-6 relative z-10">
          <motion.div 
            className="w-20 h-20 rounded-[32px] flex items-center justify-center border shadow-lg bg-bg-overlay border-border-subtle"
          >
             <tool.icon size={40} style={{ color: tool.color }} />
          </motion.div>
          <div className="space-y-2 flex flex-col items-center">
             <code className="text-2xl font-black font-mono text-text-primary">{tool.name}</code>
             <Badge variant="teal" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest shadow-sm bg-bg-overlay border border-brand-primary text-brand-primary">Essential Primitive</Badge>
          </div>
       </div>

       <motion.p className="text-xl leading-relaxed text-text-secondary m-0 relative z-10 font-bold max-w-sm">
          {tool.description}
       </motion.p>
       
       <motion.div className="w-full relative rounded-[40px] bg-bg-overlay p-10 font-mono text-sm overflow-hidden border border-border-subtle text-left">
          <div className="flex items-start justify-between gap-8">
             <pre className="text-text-muted m-0 leading-relaxed overflow-x-auto whitespace-pre-wrap font-bold">{tool.example}</pre>
             <button onClick={handleCopy} className="shrink-0 text-brand-primary opacity-40 hover:opacity-100 transition-opacity pt-1">
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
      className="min-h-screen bg-bg-base flex flex-col font-sans selection:bg-brand-primary selection:text-brand-on-primary"
    >
      <NavStub />
      
      <motion.div
        className="fixed top-0 left-0 right-0 h-1 bg-brand-primary z-[150] origin-left"
        style={{ scaleX, top: '80px' }}
      />

      {/* Hero Section */}
      <motion.section 
        className="pt-40 pb-24 px-6 sm:px-8 lg:px-12 border-b border-border-subtle relative overflow-hidden flex flex-col items-center justify-center text-center bg-bg-base"
      >
        <div className="max-w-5xl mx-auto relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-8 py-3 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl bg-bg-overlay border border-brand-primary text-brand-primary">Model Context Protocol</Badge>
           <motion.h1 
             className="text-5xl sm:text-8xl font-black tracking-tighter font-display leading-[0.85] m-0 text-text-primary"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             Context is <br />
             <span className="text-brand-primary">Coordination.</span>
           </motion.h1>
           <motion.p 
             className="text-xl sm:text-3xl max-w-4xl leading-relaxed text-text-secondary font-bold"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             One install command to give your agents the coordination infrastructure they deserve. 60+ production-grade tools for the modern swarm.
           </motion.p>
        </div>
      </motion.section>

      {/* Installation Guide */}
      <section className="py-24 bg-bg-surface border-b border-border-subtle">
        <div className="max-w-7xl mx-auto px-6 lg:px-12 flex flex-col items-center">
           <div className="text-center mb-20 space-y-6">
              <Badge variant="neutral" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-bg-overlay border border-border-strong text-text-primary">Getting Started</Badge>
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
      <motion.main className="py-24 px-6 sm:px-8 lg:px-12 max-w-7xl mx-auto w-full font-sans flex flex-col items-center">
        
        {/* Progressive Disclosure */}
        <section className="mb-32 space-y-24 w-full flex flex-col items-center">
           <div className="flex flex-col items-center text-center gap-10 w-full max-w-4xl">
              <Badge variant="neutral" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-md bg-bg-overlay border border-border-subtle text-text-primary">Agent Experience (AX)</Badge>
              <h2 className="text-4xl sm:text-7xl font-display font-black tracking-tighter m-0 leading-[0.95] text-text-primary">Master the Toolset.</h2>
              <p className="text-xl sm:text-2xl leading-relaxed text-text-secondary m-0 font-bold max-w-3xl mx-auto">
                 Port Daddy uses <strong>Progressive Disclosure</strong>. Agents start with the essentials and discover advanced primitives as the task evolves.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
              {CATEGORIES.map((cat, i) => (
                <motion.div 
                  key={cat.id}
                  className="p-10 rounded-[56px] bg-bg-surface border border-border-subtle space-y-8 group hover:border-brand-primary transition-all text-center flex flex-col items-center shadow-xl"
                  initial={{ opacity: 0, y: 32 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                >
                   <div className="flex flex-col items-center gap-6">
                      <motion.div className="w-16 h-16 rounded-[24px] bg-bg-overlay flex items-center justify-center border border-border-subtle group-hover:scale-110 transition-transform shadow-inner">
                         <cat.icon size={32} className="text-brand-primary" />
                      </motion.div>
                      <Badge variant="neutral" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest text-text-muted shadow-sm">{cat.count} Tools</Badge>
                   </div>
                   <motion.h3 className="m-0 text-2xl font-display font-black leading-tight text-text-primary">{cat.label}</motion.h3>
                </motion.div>
              ))}
           </div>
        </section>

        {/* Essential 8 Tools */}
        <section className="space-y-24 w-full flex flex-col items-center">
           <div className="text-center space-y-8 max-w-4xl">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-md bg-bg-overlay border border-brand-primary text-brand-primary">The Standard Library</Badge>
              <h2 className="text-4xl sm:text-7xl font-display font-black tracking-tighter m-0 leading-[0.95] text-text-primary">The Essentials.</h2>
              <p className="text-xl sm:text-2xl leading-relaxed text-text-secondary m-0 font-bold">
                 Primitives optimized for context window efficiency and zero-latency coordination.
              </p>
           </div>

           <div className="grid lg:grid-cols-2 gap-12 w-full">
              {ESSENTIAL_TOOLS.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
           </div>
        </section>
      </motion.main>

      <Footer />
    </motion.div>
  )
}

function NavStub() {
  return (
    <div className="fixed top-0 left-0 right-0 h-20 bg-bg-base/80 backdrop-blur-xl border-b border-border-subtle z-[100] flex items-center justify-center">
       <span className="font-black tracking-tighter text-xl text-text-primary">port-daddy.</span>
    </div>
  )
}
