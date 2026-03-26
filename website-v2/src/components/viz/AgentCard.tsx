// import * as React from 'react'
import { motion } from 'framer-motion'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Users, Zap, Shield, Cpu, Activity, Globe, MessageSquare } from 'lucide-react'

interface AgentCardProps {
  agent: {
    id: string;
    name: string | null;
    type: string;
    status: string;
    isReady: boolean;
    identity: string | null;
    purpose: string | null;
    progress: string | null;
    agentCard: any | null;
    healthAssessment: {
      liveness: 'alive' | 'stale' | 'dead';
    };
  };
}

export function AgentCard({ agent }: AgentCardProps) {
  const isA2A = !!agent.agentCard;
  const capabilities = agent.agentCard?.capabilities || [];
  const protocols = agent.agentCard?.protocols || [];

  return (
    <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--bg-surface)] shadow-lg hover:shadow-xl transition-all font-sans rounded-3xl">
      <CardHeader className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-overlay)] flex flex-row items-center justify-between gap-4 font-sans">
        <motion.div className="flex items-center gap-4 font-sans">
          <motion.div className={`p-2.5 rounded-xl bg-[var(--brand-primary)]/10 text-[var(--brand-primary)]`}>
            <Users size={20} />
          </motion.div>
          <motion.div className="font-sans">
            <motion.h3 className="text-base font-bold truncate max-w-[180px] font-display" style={{ color: 'var(--text-primary)' }}>{agent.name || agent.id}</motion.h3>
            <motion.div className="flex items-center gap-2 mt-1 font-sans">
              <Badge variant={agent.healthAssessment.liveness === 'alive' ? 'teal' : 'default'} className="text-[9px] px-1.5 py-0 font-sans">
                {agent.healthAssessment.liveness}
              </Badge>
              <motion.span className="text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-tighter">{agent.type}</motion.span>
            </motion.div>
          </motion.div>
        </motion.div>
        {isA2A && (
          <Badge variant="teal" className="bg-[var(--p-teal-400)]/15 text-[var(--p-teal-400)] border-[var(--p-teal-400)]/30 font-black text-[10px] tracking-widest px-2 py-0.5 uppercase font-sans">
            A2A Enabled
          </Badge>
        )}
      </CardHeader>
      
      <CardContent className="p-6 space-y-6 font-sans">
        {/* Identity & Purpose */}
        <motion.div className="space-y-3 font-sans">
          <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] font-sans">
            <Shield size={12} /> Identity
          </motion.div>
          <motion.code className="block p-3 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-[11px] font-mono text-[var(--brand-primary)] truncate font-mono">
            {agent.identity || 'anonymous'}
          </motion.code>
          <motion.p className="text-sm text-[var(--text-secondary)] font-medium leading-relaxed italic font-sans">
            "{agent.purpose || 'No purpose declared'}"
          </motion.p>
        </motion.div>

        {/* Progress bar if busy */}
        {agent.status === 'busy' && agent.progress && (
          <motion.div className="space-y-2 font-sans">
            <motion.div className="flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)] font-sans">
              <motion.span className="flex items-center gap-1 font-sans"><Activity size={10} /> Progress</motion.span>
              <motion.span className="text-[var(--brand-primary)] font-mono">{agent.progress}</motion.span>
            </motion.div>
            <motion.div className="h-1.5 w-full bg-[var(--bg-overlay)] rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-[var(--brand-primary)]"
                initial={{ width: 0 }}
                animate={{ width: agent.progress }}
                transition={{ duration: 1 }}
              />
            </motion.div>
          </motion.div>
        )}

        {/* A2A Capabilities Section */}
        {isA2A && (
          <motion.div className="pt-4 border-t border-[var(--border-subtle)] space-y-4 font-sans">
            <motion.div className="space-y-3 font-sans">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] font-sans">
                <Zap size={12} className="text-[var(--p-amber-400)]" /> Capabilities
              </motion.div>
              <motion.div className="flex flex-wrap gap-2 font-sans">
                {capabilities.map((cap: string) => (
                  <Badge key={cap} variant="default" className="text-[10px] font-black uppercase tracking-widest bg-[var(--bg-overlay)] border-[var(--border-subtle)] font-sans">
                    {cap}
                  </Badge>
                ))}
                {capabilities.length === 0 && <motion.span className="text-[10px] text-[var(--text-muted)] italic font-sans">No specific capabilities listed</motion.span>}
              </motion.div>
            </motion.div>

            <motion.div className="space-y-3 font-sans">
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)] font-sans">
                <Globe size={12} className="text-[var(--p-teal-400)]" /> Protocols
              </motion.div>
              <motion.div className="flex flex-wrap gap-2 font-sans">
                {protocols.map((proto: string) => (
                  <Badge key={proto} variant="default" className="text-[10px] font-mono font-bold uppercase font-mono">
                    {proto}
                  </Badge>
                ))}
                {protocols.length === 0 && <motion.span className="text-[10px] text-[var(--text-muted)] italic font-sans">A2A Standard</motion.span>}
              </motion.div>
            </motion.div>

            {agent.agentCard?.version && (
              <motion.div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)] pt-2 font-sans">
                <Cpu size={12} /> Agent Spec v{agent.agentCard.version}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* Action Buttons (Mock) */}
        <motion.div className="flex gap-3 pt-2 font-sans">
          <motion.button 
            className="flex-1 px-4 py-3 rounded-xl bg-[var(--interactive-hover)] border border-[var(--border-subtle)] text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[var(--brand-primary)] hover:text-white transition-all font-sans"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <MessageSquare size={14} /> Send Msg
          </motion.button>
          <motion.button 
            className="px-4 py-3 rounded-xl bg-[var(--interactive-hover)] border border-[var(--border-subtle)] text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[var(--interactive-active)] transition-all font-sans"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Details
          </motion.button>
        </motion.div>
      </CardContent>
    </Card>
  )
}
