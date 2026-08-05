import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { ProductLogoMark, type ProductLogoKey } from '@/components/site/ProductLogos'
import { Surface } from '@/components/ui/Surface'
import {
  Code, Cpu, Layers,
  Terminal, ChevronRight, MessageSquare, Globe
} from 'lucide-react'

interface AgentTool {
  name: string
  tagline: string
  how: string
  icon: typeof Code
  color: string
  product?: ProductLogoKey
}

const TOOLS: AgentTool[] = [
  { name: 'Claude Code', tagline: 'MCP Native', how: 'pd mcp install gives every Claude Code session full Port Daddy tools — ports, sessions, notes, pub/sub', icon: Cpu, color: 'var(--brand-primary)', product: 'claude' },
  { name: 'Aider', tagline: 'pd spawn', how: 'pd spawn --backend aider launches Aider with Port Daddy coordination wired in automatically', icon: Code, color: 'var(--brand-accent)' },
  { name: 'Ollama', tagline: 'Local LLM', how: 'pd spawn --backend ollama runs any local model with full session tracking and pub/sub', icon: Layers, color: 'var(--brand-primary)', product: 'ollama' },
  { name: 'Any CLI Tool', tagline: 'Universal', how: 'pd spawn --backend custom wraps any command-line tool with Port Daddy coordination', icon: Terminal, color: 'var(--brand-accent)' },
]

export function AgentEcosystem() {
  return (
    <motion.section
      id="ecosystem"
      className="py-16 lg:py-24 px-6 lg:px-8 font-sans relative overflow-hidden"
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
          <Badge variant="teal" className="px-6 py-2 text-[12px] font-black uppercase tracking-[0.25em]">The Integration Layer</Badge>
          <motion.h2 className="text-3xl sm:text-5xl lg:text-7xl font-bold font-display tracking-tight leading-[0.9] mb-10" style={{ color: 'var(--text-primary)' }}>
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
            <div key={tool.name} className="group">
              <motion.div
                className="h-full p-6 sm:p-8 lg:p-12 rounded-[var(--radius-4xl)] transition-all duration-300 flex flex-col items-center text-center gap-10"
                style={{
                  background: 'var(--surface-raised)',
                  boxShadow: 'var(--shadow-raised)',
                }}
                whileHover={{ y: -12, boxShadow: 'var(--shadow-sm)' }}
              >
                {/* Icon in inset circle */}
                <Surface depth="inset" radius="3xl" padding="none" className="w-20 h-20 flex items-center justify-center transition-all group-hover:scale-110">
                  {tool.product ? (
                    <ProductLogoMark product={tool.product} className="h-11 w-11" />
                  ) : (
                    <tool.icon size={40} style={{ color: 'var(--brand-accent)' }} />
                  )}
                </Surface>

                <div className="space-y-4 flex-1 flex flex-col items-center">
                   <div className="flex flex-col items-center gap-3">
                      <motion.h3 className="m-0 text-3xl font-display font-black leading-tight" style={{ color: 'var(--text-primary)' }}>{tool.name}</motion.h3>
                      <Badge variant="default" className="text-[12px] font-black uppercase tracking-widest px-3 py-1">{tool.tagline}</Badge>
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
          className="mt-24 p-6 sm:p-10 lg:p-20 rounded-[var(--radius-4xl)] relative overflow-hidden w-full flex flex-col items-center text-center"
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
              <Badge variant="gold" className="px-6 py-2 text-[12px] font-black uppercase tracking-widest">Coordination Pattern</Badge>
              <motion.h3 className="text-5xl sm:text-7xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span style={{ color: 'var(--brand-accent)' }}>Daemon</span> <br /> Pattern.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-80 max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Your agents coordinate through a shared local daemon. One agent claims a port and publishes events, while others subscribe for updates through the published local endpoint the daemon advertises when your machine differs.
              </motion.p>

              <div className="w-full max-w-2xl pt-6">
                 <motion.div
                   className="flex items-start gap-8 p-10 rounded-[var(--radius-4xl)] text-left group transition-all"
                   style={{
                     background: 'var(--surface-raised)',
                     boxShadow: 'var(--shadow-sm)',
                   }}
                   whileHover={{ boxShadow: 'var(--shadow-raised)' }}
                 >
                    {/* Icon in inset circle */}
                    <Surface depth="inset" radius="full" padding="none" className="w-14 h-14 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                       <MessageSquare style={{ color: 'var(--brand-accent)' }} size={28} />
                    </Surface>
                    <div className="space-y-3">
                       <motion.p className="font-black m-0 text-xl tracking-tight" style={{ color: 'var(--text-primary)' }}>Cross-Framework Signaling</motion.p>
                       <motion.p className="text-base m-0 opacity-80 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>Agents from any framework publish and subscribe through the local daemon's REST API and SSE streams, enabling real-time coordination across tool boundaries.</motion.p>
                    </div>
                 </motion.div>
              </div>
           </div>
        </motion.div>
      </motion.div>
    </motion.section>
  )
}
