import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Code, Cpu, MessageSquare, Terminal, Zap, Layers, Share2, Globe, ChevronRight } from 'lucide-react'

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
      className="py-32 px-4 sm:px-6 lg:px-8 font-sans relative overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true }}
    >
      <motion.div className="max-w-7xl mx-auto relative z-10 font-sans">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center mb-32"
        >
          <Badge variant="teal" className="mb-10 px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">The Integration Layer</Badge>
          <motion.h2 className="text-5xl sm:text-8xl font-bold font-display tracking-tight leading-[0.95] mb-10" style={{ color: 'var(--text-primary)' }}>
            One protocol. <motion.span className="text-[var(--brand-primary)]">Any Agent.</motion.span>
          </motion.h2>
          <motion.p className="text-xl sm:text-2xl max-w-4xl mx-auto leading-relaxed opacity-70" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy is framework-agnostic. It provides the low-level primitives needed to make agents from different families work together in a single harbor.
          </motion.p>
        </motion.div>

        <motion.div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {TOOLS.map((tool, i) => (
            <motion.div
              key={tool.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.05 }}
              className="group"
            >
              <motion.div 
                className="h-full p-10 rounded-[48px] border transition-all duration-[var(--p-transition-spring)] flex flex-col items-start gap-8"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface)' }}
                whileHover={{ y: -10, borderColor: tool.color, boxShadow: `0 32px 64px -12px ${tool.color}15` }}
              >
                <motion.div 
                  className="w-16 h-16 rounded-[24px] flex items-center justify-center border transition-all group-hover:scale-110"
                  style={{ background: `${tool.color}10`, borderColor: `${tool.color}20` }}
                >
                  <tool.icon size={32} style={{ color: tool.color }} />
                </motion.div>

                <motion.div className="space-y-3 flex-1">
                   <motion.div className="flex items-center gap-3">
                      <motion.h3 className="m-0 text-2xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{tool.name}</motion.h3>
                      <Badge variant="neutral" className="text-[8px] font-black uppercase tracking-widest">{tool.tagline}</Badge>
                   </motion.div>
                   <motion.p className="m-0 text-base opacity-60 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                     {tool.how}
                   </motion.p>
                </motion.div>

                <motion.div className="w-full flex items-center justify-between opacity-20 group-hover:opacity-100 transition-opacity">
                   <motion.div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-[var(--border-strong)]" />
                   <ChevronRight size={16} className="text-[var(--text-muted)] ml-4" />
                </motion.div>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>

        {/* Multi-Agent Coordination Example */}
        <motion.div 
          className="mt-32 p-16 rounded-[60px] bg-[var(--bg-surface)] border border-[var(--border-strong)] relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
              <Globe size={400} className="text-[var(--brand-primary)]" />
           </motion.div>
           
           <motion.div className="max-w-3xl relative z-10 space-y-10">
              <Badge variant="amber" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest">Coordination Pattern</Badge>
              <motion.h3 className="text-4xl sm:text-6xl font-display font-black leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                The <motion.span className="text-[var(--p-amber-400)]">Lighthouse</motion.span> Pattern.
              </motion.h3>
              <motion.p className="text-xl leading-relaxed opacity-70">
                Teach your swarms to discover each other via a central daemon. One agent claims a semantic harbor, while others subscribe to its Swarm Radio channels for real-time state updates.
              </motion.p>
              
              <motion.div className="grid gap-4">
                 <motion.div className="flex items-start gap-6 p-8 rounded-3xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)]">
                    <motion.div className="w-10 h-10 rounded-full bg-[var(--p-teal-500)]/10 flex items-center justify-center shrink-0">
                       <MessageSquare className="text-[var(--p-teal-400)]" size={20} />
                    </motion.div>
                    <motion.div className="space-y-2">
                       <motion.p className="font-bold m-0 text-lg">Cross-Framework Signaling</motion.p>
                       <motion.p className="text-sm m-0 opacity-60 leading-relaxed">A LangChain agent can publish an event that a CrewAI task is waiting for, bridged instantly by the Port Daddy daemon.</motion.p>
                    </motion.div>
                 </motion.div>
              </motion.div>
           </motion.div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
