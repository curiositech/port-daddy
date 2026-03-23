import { Badge } from '@/components/ui/Badge'
<<<<<<< HEAD
import { 
  Code, Cpu, Layers, Share2, Zap, 
  Terminal, ChevronRight, MessageSquare 
} from 'lucide-react'
=======
import { Code, Cpu, MessageSquare, Terminal, Layers, Globe, ChevronRight } from 'lucide-react'
>>>>>>> worktree-agent-ae9460d3

interface AgentTool {
  name: string
  tagline: string
  how: string
  icon: typeof Code
  color: string
}

const TOOLS: AgentTool[] = [
<<<<<<< HEAD
  { name: 'Claude Code', tagline: 'MCP native', how: 'pd mcp install → tools in every session', icon: Cpu, color: 'var(--brand-primary)' },
  { name: 'LangChain', tagline: 'Unified Tools', how: 'Wrap identities in Tools for universal discovery', icon: Layers, color: 'var(--warning)' },
  { name: 'CrewAI', tagline: 'Swarm Logic', how: 'Assign one Port Daddy session per crew member', icon: Share2, color: 'var(--info)' },
  { name: 'Gemini CLI', tagline: 'Google AI', how: 'Native extension for port & harbor control', icon: Zap, color: 'var(--success)' },
  { name: 'Aider', tagline: 'Git-Native', how: 'pd begin wraps every autonomous session', icon: Code, color: '#22c55e' },
  { name: 'Continue.dev', tagline: 'IDE Context', how: 'File claims prevent multi-agent collisions', icon: Terminal, color: '#ef4444' },
=======
  { name: 'Claude Code', tagline: 'MCP native', how: 'pd mcp install -- tools available in every Claude Code session automatically', icon: Cpu, color: 'var(--p-teal-400)' },
  { name: 'Ollama', tagline: 'Local LLMs', how: 'pd spawn --backend ollama -- run local models with Port Daddy coordination built in', icon: Layers, color: 'var(--p-amber-400)' },
  { name: 'Aider', tagline: 'Git-Native', how: 'pd spawn --backend aider -- autonomous coding sessions with heartbeats and salvage', icon: Code, color: 'var(--p-green-400)' },
  { name: 'HTTP API', tagline: 'Any Agent', how: 'Port Daddy works with any agent that can make HTTP calls to localhost:9876', icon: Terminal, color: 'var(--p-blue-400)' },
>>>>>>> worktree-agent-ae9460d3
]

export function AgentEcosystem() {
  return (
    <section id="ecosystem" className="py-24 lg:py-32 bg-[var(--bg-surface)]">
      <div className="max-w-[1200px] mx-auto px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="teal" className="mb-4">The Integration Layer</Badge>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold text-[var(--text-primary)] mb-4">
            One protocol. <span className="text-[var(--brand-primary)]">Any Agent.</span>
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Port Daddy is framework-agnostic. It provides the low-level primitives needed to make agents from different families work together.
          </p>
        </div>

        {/* Tools Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {TOOLS.map((tool) => (
            <div
              key={tool.name}
              className="group p-6 rounded-xl bg-[var(--bg-base)] border border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)] transition-all"
            >
              <div 
                className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                style={{ background: `${tool.color}15` }}
              >
<<<<<<< HEAD
                <tool.icon size={24} style={{ color: tool.color }} />
=======
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
                   <motion.p className="m-0 text-lg opacity-80 leading-relaxed group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>
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
          className="mt-24 p-20 rounded-[80px] bg-[var(--bg-overlay)] border border-[var(--border-strong)] relative overflow-hidden shadow-2xl w-full flex flex-col items-center text-center"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Globe size={600} className="text-[var(--brand-primary)]" />
           </div>
           
           <div className="max-w-4xl relative z-10 space-y-12 flex flex-col items-center">
              <Badge variant="amber" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Coordination Pattern</Badge>
              <motion.h3 className="text-5xl sm:text-7xl font-display font-black leading-[0.95] m-0" style={{ color: 'var(--text-primary)' }}>
                The <span className="text-[var(--p-amber-400)]">Lighthouse</span> <br /> Pattern.
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed opacity-80 max-w-2xl mx-auto">
                Teach your swarms to discover each other via a central daemon. One agent claims a semantic harbor, while others subscribe to its Swarm Radio channels for real-time state updates.
              </motion.p>
              
              <div className="w-full max-w-2xl pt-6">
                 <motion.div className="flex items-start gap-8 p-10 rounded-[48px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-left group hover:border-[var(--p-teal-500)] transition-colors shadow-xl">
                    <motion.div className="w-14 h-14 rounded-full bg-[var(--p-teal-500)]/10 flex items-center justify-center shrink-0 shadow-inner group-hover:scale-110 transition-transform">
                       <MessageSquare className="text-[var(--p-teal-400)]" size={28} />
                    </motion.div>
                    <div className="space-y-3">
                       <motion.p className="font-black m-0 text-xl tracking-tight">Cross-Framework Signaling</motion.p>
                       <motion.p className="text-base m-0 opacity-80 leading-relaxed">Any agent that can make HTTP calls can publish events that other agents are waiting for, bridged by the Port Daddy daemon's pub/sub system.</motion.p>
                    </div>
                 </motion.div>
>>>>>>> worktree-agent-ae9460d3
              </div>

              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-[var(--text-primary)]">{tool.name}</h3>
                <Badge variant="neutral" size="sm">{tool.tagline}</Badge>
              </div>
              
              <p className="text-sm text-[var(--text-tertiary)] mb-4">
                {tool.how}
              </p>

              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] group-hover:text-[var(--brand-primary)] transition-colors">
                <span>Learn more</span>
                <ChevronRight size={12} />
              </div>
            </div>
          ))}
        </div>

        {/* Lighthouse Pattern */}
        <div className="p-8 lg:p-12 rounded-2xl bg-[var(--bg-base)] border border-[var(--border-subtle)]">
          <div className="text-center mb-10">
            <Badge variant="amber" className="mb-4">Coordination Pattern</Badge>
            <h3 className="text-2xl lg:text-3xl font-semibold text-[var(--text-primary)] mb-3">
              The <span className="text-[var(--warning)]">Lighthouse</span> Pattern
            </h3>
            <p className="text-[var(--text-secondary)] max-w-2xl mx-auto">
              Teach your swarms to discover each other via a central daemon. One agent claims a semantic harbor, while others subscribe for real-time updates.
            </p>
          </div>

          <div className="max-w-2xl mx-auto">
            <div className="flex items-start gap-4 p-5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
              <div className="w-10 h-10 rounded-full bg-[var(--brand-primary)]/10 flex items-center justify-center shrink-0">
                <MessageSquare size={18} className="text-[var(--brand-primary)]" />
              </div>
              <div>
                <h4 className="font-semibold text-[var(--text-primary)] mb-1">Cross-Framework Signaling</h4>
                <p className="text-sm text-[var(--text-tertiary)]">
                  A LangChain agent can publish an event that a CrewAI task is waiting for, bridged instantly by the Port Daddy daemon.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
