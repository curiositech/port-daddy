import * as React from 'react'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Shield, Zap, Anchor, Share2, MessageSquare, Box, Copy, Check, ShieldCheck } from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

/* ─── Documentation Data ─────────────────────────────────────────────────── */

interface DocSection {
  id: string
  title: string
  description: string
  icon: any
  color: string
  commands: Array<{
    cmd: string
    desc: string
    example: string
  }>
}

const SECTIONS: DocSection[] = [
  {
    id: 'identity',
    title: 'Atomic Identity',
    description: 'The foundation of Port Daddy. Map semantic project:stack:context strings to deterministic ports.',
    icon: Anchor,
    color: 'var(--p-teal-400)',
    commands: [
      { cmd: 'pd claim <identity>', desc: 'Claim a stable port for an agent identity.', example: 'pd claim my-swarm:api:main' },
      { cmd: 'pd release <identity>', desc: 'Release a claim and free the port.', example: 'pd release my-swarm:api:main' },
      { cmd: 'pd find <identity>', desc: 'Locate an existing claim without re-assigning.', example: 'pd find my-swarm:api:main' }
    ]
  },
  {
    id: 'coordination',
    title: 'Swarm Radio',
    description: 'Low-latency pub/sub signaling for real-time inter-agent state synchronization.',
    icon: MessageSquare,
    color: 'var(--brand-accent)',
    commands: [
      { cmd: 'pd pub <channel> <msg>', desc: 'Broadcast a message to a named channel.', example: 'pd pub swarm:events "deploy-ready"' },
      { cmd: 'pd sub <channel>', desc: 'Subscribe to a real-time stream of events.', example: 'pd sub swarm:events' },
      { cmd: 'pd watch <channel>', desc: 'Execute a script whenever a message arrives.', example: 'pd watch build:done --exec ./test.sh' }
    ]
  },
  {
    id: 'security',
    title: 'Cryptographic Harbors',
    description: 'Enforce permission boundaries using HMAC-signed capability tokens (Harbor Cards).',
    icon: Shield,
    color: 'var(--p-blue-400)',
    commands: [
      { cmd: 'pd harbor create <name>', desc: 'Create a new namespace with scoped permissions.', example: 'pd harbor create security-team --cap "code:read"' },
      { cmd: 'pd harbor enter <name>', desc: 'Enter a harbor and receive an identity token.', example: 'pd harbor enter security-team' },
      { cmd: 'pd harbor list', desc: 'List all active cryptographic harbors.', example: 'pd harbor list' }
    ]
  }
]

function CommandCard({ cmd, desc, example, color }: { cmd: string; desc: string; example: string; color: string }) {
  const [copied, setCopied] = React.useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(example)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div 
      className="p-8 rounded-[40px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-6 group hover:border-[var(--border-strong)] transition-all shadow-xl flex flex-col items-center text-center"
      whileHover={{ y: -4 }}
    >
       <motion.div className="space-y-4 w-full">
          <code className="text-xl font-bold font-mono block" style={{ color }}>{cmd}</code>
          <motion.p className="text-sm leading-relaxed m-0 font-medium" style={{ color: 'var(--text-muted)' }}>{desc}</motion.p>
       </motion.div>
       
       <motion.div className="relative w-full rounded-2xl bg-[var(--bg-overlay)] p-6 font-mono text-xs overflow-hidden group-hover:bg-[var(--interactive-active)] transition-colors">
          <motion.div className="flex items-center justify-between gap-4">
             <motion.span className="truncate" style={{ color: 'var(--text-muted)' }}>{example}</motion.span>
             <button onClick={handleCopy} className="shrink-0 text-[var(--brand-primary)] hover:opacity-100 transition-opacity">
                {copied ? <Check size={14} /> : <Copy size={14} />}
             </button>
          </motion.div>
       </motion.div>
    </motion.div>
  )
}

export default function DocsPage() {
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
      <motion.section className="py-20 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.1] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <motion.div className="max-w-7xl mx-auto text-center relative z-10 flex flex-col items-center gap-10">
           <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Protocol Reference</Badge>
           <motion.h1 
             className="text-6xl sm:text-9xl font-black tracking-tighter font-display leading-[0.9]"
             initial={{ opacity: 0, y: 32 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
           >
             The <motion.span className="text-[var(--brand-primary)]">SDK Manual.</motion.span>
           </motion.h1>
           <motion.p 
             className="text-2xl sm:text-3xl max-w-3xl leading-relaxed text-[var(--text-secondary)] font-medium"
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             transition={{ duration: 0.8, delay: 0.1 }}
           >
             Comprehensive enumeration of the Port Daddy primitives. Built for developers, agents, and architects.
           </motion.p>
        </motion.div>
      </motion.section>

      {/* Main Content */}
      <motion.main id="main-content" className="flex-1 py-24 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <motion.div className="space-y-32 flex flex-col items-center">
          {SECTIONS.map((section) => (
            <motion.section 
              key={section.id}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              id={section.id}
              className="space-y-16 flex flex-col items-center w-full"
            >
               <motion.div className="flex flex-col items-center text-center gap-10 border-b border-[var(--border-subtle)] pb-16 w-full">
                  <motion.div className="max-w-2xl flex flex-col items-center gap-8">
                     <motion.div className="flex flex-col items-center gap-6">
                        <motion.div 
                          className="w-16 h-16 rounded-2xl flex items-center justify-center border shadow-lg"
                          style={{ background: `${section.color}10`, borderColor: `${section.color}20` }}
                        >
                           <section.icon size={32} style={{ color: section.color }} />
                        </motion.div>
                        <motion.h2 className="text-4xl sm:text-7xl font-display font-black tracking-tight m-0">{section.title}</motion.h2>
                     </motion.div>
                     <motion.p className="text-xl sm:text-2xl leading-relaxed m-0 font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {section.description}
                     </motion.p>
                  </motion.div>
                  <Badge variant="default" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-[var(--bg-overlay)]">Core Primitive</Badge>
               </motion.div>

               <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 w-full">
                  {section.commands.map((cmd, j) => (
                    <CommandCard key={j} {...cmd} color={section.color} />
                  ))}
               </motion.div>
            </motion.section>
          ))}
        </motion.div>

        {/* Impressively long additional info */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--border-strong)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Share2 size={600} />
           </motion.div>
           
           <motion.div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Architectural Integrity</Badge>
              <motion.h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                System <motion.span className="text-[var(--brand-accent)]">Soundness.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed text-[var(--text-secondary)]">
                Port Daddy is built on a foundation of formal verification. We ensure that every command follows strictly defined state transitions, preventing "zombie" processes and unauthorized port claims across your entire swarm.
              </motion.p>
           </motion.div>

           <motion.div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
              {[
                { label: 'Unix Socket Native', icon: Zap },
                { label: 'HMAC Handshake', icon: Shield },
                { label: 'SQLite Persistent', icon: Box },
                { label: 'Formal Verified', icon: ShieldCheck }
              ].map((item, i) => (
                <motion.div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">{item.label}</motion.span>
                </motion.div>
              ))}
           </motion.div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
