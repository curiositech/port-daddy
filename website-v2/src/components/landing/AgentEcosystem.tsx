import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import {
  Code, Cpu, Layers, Share2, Zap,
  Terminal, ChevronRight, MessageSquare, Globe
} from 'lucide-react'

interface AgentTool {
  name: string
  tagline: string
  how: string
  icon: typeof Code
  color: string
}

const TOOLS: AgentTool[] = [
  { name: 'Claude Code', tagline: 'MCP native', how: 'pd mcp install → tools in every session', icon: Cpu, color: 'var(--brand-primary)' },
  { name: 'LangChain', tagline: 'Unified Tools', how: 'Wrap identities in Tools for universal discovery', icon: Layers, color: 'var(--brand-accent)' },
  { name: 'CrewAI', tagline: 'Swarm Logic', how: 'Assign one Port Daddy session per crew member', icon: Share2, color: 'var(--brand-primary)' },
  { name: 'Gemini CLI', tagline: 'Google AI', how: 'Native extension for port & harbor control', icon: Zap, color: 'var(--brand-accent)' },
  { name: 'Aider', tagline: 'Git-Native', how: 'pd begin wraps every autonomous session', icon: Code, color: 'var(--brand-primary)' },
  { name: 'Continue.dev', tagline: 'IDE Context', how: 'File claims prevent multi-agent collisions', icon: Terminal, color: 'var(--brand-accent)' },
]

export function AgentEcosystem() {
  return (
    <motion.section
      id="ecosystem"
      className="py-24 px-6 sm:px-8 lg:px-10 font-sans relative overflow-hidden"
      style={{ background: 'var(--surface-base)' }}
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
          className="text-center mb-16 flex flex-col items-center gap-12"
        >
          <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">The Integration Layer</Badge>
          <motion.h2 className="text-5xl sm:text-7xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
            One protocol. <br />
            <motion.span style={{ color: 'var(--brand-primary)' }}>Any Agent.</motion.span>
          </motion.h2>
          <motion.p className="text-2xl sm:text-3xl max-w-4xl mx-auto leading-relaxed opacity-80 font-sans" style={{ color: 'var(--text-secondary)' }}>
            Port Daddy is framework-agnostic. It provides the low-level primitives needed to make agents from different families work together in a single harbor.
          </motion.p>
        </motion.div>

        {/* Tools Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="group p-6 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <motion.div
                className="h-full p-12 rounded-[56px] transition-all duration-300 flex flex-col items-center text-center gap-10"
                style={{
                  background: 'var(--surface-raised)',
                  boxShadow: 'var(--shadow-raised)',
                }}
                whileHover={{ y: -12, boxShadow: 'var(--shadow-sm)' }}
              >
                {/* Icon in inset circle */}
                <motion.div
                  className="w-20 h-20 rounded-[32px] flex items-center justify-center transition-all group-hover:scale-110"
                  style={{
                    background: 'var(--surface-base)',
                    boxShadow: 'var(--shadow-inset)',
                  }}
                >
                  <tool.icon size={40} style={{ color: 'var(--brand-accent)' }} />
                </motion.div>

                <div className="space-y-4 flex-1 flex flex-col items-center">
                   <div className="flex flex-col items-center gap-3">
                      <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{tool.name}</motion.h3>
                      <Badge variant="default" className="text-[8px] font-black uppercase tracking-widest px-3 py-1">{tool.tagline}</Badge>
                   </div>
                   <motion.p className="m-0 text-lg opacity-80 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
                     {tool.how}
                   </motion.p>
                </div>

                {/* Divider with accent color */}
                <div className="w-full flex items-center justify-center gap-4 opacity-20 group-hover:opacity-100 transition-opacity">
                   <div className="h-[1px] flex-1" style={{ background: 'linear-gradient(to right, transparent, var(--brand-accent))' }} />
                   <ChevronRight size={16} style={{ color: 'var(--brand-accent)' }} />
                   <div className="h-[1px] flex-1" style={{ background: 'linear-gradient(to left, transparent, var(--brand-accent))' }} />
                </div>
              </motion.div>
            </div>
          ))}
        </div>

        {/* Multi-Agent Coordination Example */}
        <motion.div
          className="mt-24 p-20 rounded-[80px] relative overflow-hidden w-full flex flex-col items-center text-center"
          style={{
            background: 'var(--surface-raised)',
            boxShadow: 'var(--shadow-raised)',
          }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Globe size={600} style={{ color: 'var(--brand-primary)' }} />
           </div>

           <div className="max-w-4xl relative z-10 space-y-12 flex flex-col items-center">
              <Badge variant="gold" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Coordination Pattern</Badge>
              <motion.h3 className="text-5xl sm:text-7xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span style={{ color: 'var(--brand-accent)' }}>Lighthouse</span> <br /> Pattern.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-80 max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Teach your swarms to discover each other via a central daemon. One agent claims a semantic harbor, while others subscribe to its Swarm Radio channels for real-time state updates.
              </motion.p>

              <div className="w-full max-w-2xl pt-6">
                 <motion.div
                   className="flex items-start gap-8 p-10 rounded-[48px] text-left group transition-all"
                   style={{
                     background: 'var(--surface-raised)',
                     boxShadow: 'var(--shadow-sm)',
                   }}
                   whileHover={{ boxShadow: 'var(--shadow-raised)' }}
                 >
                    {/* Icon in inset circle */}
                    <motion.div
                      className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"
                      style={{
                        background: 'var(--surface-base)',
                        boxShadow: 'var(--shadow-inset)',
                      }}
                    >
                       <MessageSquare style={{ color: 'var(--brand-accent)' }} size={28} />
                    </motion.div>
                    <div className="space-y-3">
                       <motion.p className="font-black m-0 text-xl tracking-tight" style={{ color: 'var(--text-primary)' }}>Cross-Framework Signaling</motion.p>
                       <motion.p className="text-base m-0 opacity-80 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>A LangChain agent can publish an event that a CrewAI task is waiting for, bridged instantly by the Port Daddy daemon.</motion.p>
                    </div>
                 </motion.div>
              </div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
