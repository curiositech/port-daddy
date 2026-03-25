import { Badge } from '@/components/ui/Badge'
import { 
  Code, Cpu, Layers, Share2, Zap, 
  Terminal, ChevronRight, MessageSquare 
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
  { name: 'LangChain', tagline: 'Unified Tools', how: 'Wrap identities in Tools for universal discovery', icon: Layers, color: 'var(--warning)' },
  { name: 'CrewAI', tagline: 'Swarm Logic', how: 'Assign one Port Daddy session per crew member', icon: Share2, color: 'var(--info)' },
  { name: 'Gemini CLI', tagline: 'Google AI', how: 'Native extension for port & harbor control', icon: Zap, color: 'var(--success)' },
  { name: 'Aider', tagline: 'Git-Native', how: 'pd begin wraps every autonomous session', icon: Code, color: '#22c55e' },
  { name: 'Continue.dev', tagline: 'IDE Context', how: 'File claims prevent multi-agent collisions', icon: Terminal, color: '#ef4444' },
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
                <tool.icon size={24} style={{ color: tool.color }} />
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
