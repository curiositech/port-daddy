import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Boxes, Code, Cpu, MessageSquare, Terminal, Zap, Layers, Share2, Globe, ChevronRight } from 'lucide-react'

interface AgentTool {
  name: string
  tagline: string
  how: string
  icon: any
  color: string
}

const TOOLS: AgentTool[] = [
  { name: 'Claude Code', tagline: 'MCP native', how: 'pd mcp install → tools in every session', icon: Cpu, color: 'var(--p-teal-400)' },
  { name: 'LangChain', tagline: 'Unified Tools', how: 'Wrap identities in Tools for universal discovery', icon: Layers, color: 'var(--p-amber-400)' },
  { name: 'CrewAI', tagline: 'Swarm Logic', how: 'Assign one Port Daddy session per crew member', icon: Share2, color: 'var(--p-blue-400)' },
  { name: 'Gemini CLI', tagline: 'Google AI', how: 'Native extension for port & harbor control', icon: Zap, color: 'var(--p-purple-400)' },
  { name: 'Aider', tagline: 'Git-Native', how: 'pd begin wraps every autonomous session', icon: Code, color: 'var(--p-green-400)' },
  { name: 'Continue.dev', tagline: 'IDE Context', how: 'File claims prevent multi-agent collisions', icon: Terminal, color: 'var(--p-red-400)' },
]

export function AgentEcosystem() {
  return (
    <motion.section 
      id="ecosystem" 
      className="py-48 px-6 sm:px-8 lg:px-10 font-sans relative overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-40 flex flex-col items-center gap-12"
        >
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Integration Layer</Badge>
          <motion.h2 className="text-6xl sm:text-9xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
            One protocol. <br />
            <motion.span className="text-[var(--brand-primary)]">Any Agent.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed opacity-70 font-sans" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy is framework-agnostic. It provides the low-level primitives needed to make agents from different families work together in a single harbor.
          </motion.p>
        </motion.div>

        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-12 w-full">
          {TOOLS.map((tool, i) => (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
              className="group"
            >
              <motion.div 
                className="h-full p-12 rounded-[56px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-center text-center gap-10"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                whileHover={{ y: -12, borderColor: tool.color, boxShadow: `0 40px 80px -20px ${tool.color}15` }}
              >
                <motion.div 
                  className="w-20 h-20 rounded-[32px] flex items-center justify-center border transition-all group-hover:scale-110"
                  style={{ background: `${tool.color}10`, borderColor: `${tool.color}20` }}
                >
                  <tool.icon size={40} style={{ color: tool.color }} />
                </motion.div>

                <div className="space-y-4 flex-1 flex flex-col items-center">
                   <div className="flex flex-col items-center gap-3">
                      <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{tool.name}</motion.h3>
                      <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest px-3 py-1 shadow-sm">{tool.tagline}</Badge>
                   </div>
                   <motion.p className="m-0 text-lg opacity-60 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                     {tool.how}
                   </motion.p>
                </div>

                <div className="w-full flex items-center justify-center gap-4 opacity-20 group-hover:opacity-100 transition-opacity">
                   <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-[var(--border-strong)]" />
                   <ChevronRight size={16} className="text-[var(--text-muted)]" />
                   <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-[var(--border-strong)]" />
                </div>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>

        {/* Multi-Agent Coordination Example */}
        <motion.div 
          className="mt-48 p-20 rounded-[80px] bg-[var(--bg-overlay)] border border-[var(--border-strong)] relative overflow-hidden shadow-2xl w-full flex flex-col items-center text-center"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Globe size={600} className="text-[var(--brand-primary)]" />
           </div>
           
           <div className="max-w-4xl relative z-10 space-y-12 flex flex-col items-center">
              <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Coordination Pattern</Badge>
              <motion.h3 className="text-5xl sm:text-8xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span className="text-[var(--p-amber-400)]">Lighthouse</span> <br /> Pattern.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-70 max-w-2xl mx-auto">
                Teach your swarms to discover each other via a central daemon. One agent claims a semantic harbor, while others subscribe to its Swarm Radio channels for real-time state updates.
              </motion.p>
              
              <div className="w-full max-w-2xl pt-6">
                 <motion.div className="flex items-start gap-8 p-10 rounded-[48px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-left group hover:border-[var(--p-teal-500)] transition-colors shadow-xl">
                    <motion.div className="w-14 h-14 rounded-full bg-[var(--p-teal-500)]/10 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform">
                       <MessageSquare className="text-[var(--p-teal-400)]" size={28} />
                    </motion.div>
                    <div className="space-y-3">
                       <motion.p className="font-black m-0 text-xl tracking-tight">Cross-Framework Signaling</motion.p>
                       <motion.p className="text-base m-0 opacity-60 leading-relaxed">A LangChain agent can publish an event that a CrewAI task is waiting for, bridged instantly by the Port Daddy daemon.</p>
                    </div>
                 </motion.div>
              </div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
