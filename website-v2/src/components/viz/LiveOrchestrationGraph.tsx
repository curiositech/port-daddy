import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SailorAgent } from './SailorAgent'
import { Anchor, Shield, Zap, Globe, Share2, Cpu, Terminal, Activity, MessageSquare } from 'lucide-react'

interface LiveOrchestrationGraphProps {
  services?: any[]
  agents?: any[]
  onSelectAgent?: (id: string) => void
  selectedAgentId?: string | null
}

export function LiveOrchestrationGraph({ 
  services = [], 
  agents = [], 
  onSelectAgent,
  selectedAgentId 
}: LiveOrchestrationGraphProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 800, height: 600 });

  React.useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setDimensions({ 
          width: containerRef.current.clientWidth || 800, 
          height: containerRef.current.clientHeight || 600 
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const cx = dimensions.width / 2;
  const cy = dimensions.height / 2;

  // Placeholder logic for nodes if real data is missing
  const displayAgents = agents.length > 0 ? agents : [
    { id: 'alpha', label: 'analyst', type: 'agent', status: 'active' },
    { id: 'beta', label: 'coder', type: 'agent', status: 'idle' },
    { id: 'gamma', label: 'reviewer', type: 'agent', status: 'active' }
  ];

  const displayServices = services.length > 0 ? services : [
    { id: 'api', label: 'main-api', type: 'service', status: 'healthy' },
    { id: 'db', label: 'postgres', type: 'service', status: 'healthy' }
  ];

  return (
    <div ref={containerRef} className="w-full h-full relative cursor-grab active:cursor-grabbing font-sans">
      <svg width={dimensions.width} height={dimensions.height} className="absolute inset-0 pointer-events-none">
        <defs>
          <radialGradient id="meshGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0" />
          </radialGradient>
        </defs>
        
        {/* Connection Lines */}
        {displayAgents.map((agent, i) => (
          <motion.line
            key={`line-${agent.id}`}
            x1={cx}
            y1={cy}
            x2={cx + Math.cos((i / displayAgents.length) * 2 * Math.PI) * 200}
            y2={cy + Math.sin((i / displayAgents.length) * 2 * Math.PI) * 200}
            stroke="var(--brand-primary)"
            strokeWidth="1"
            strokeDasharray="4 4"
            initial={{ opacity: 0, pathLength: 0 }}
            animate={{ opacity: 0.2, pathLength: 1 }}
            transition={{ duration: 1, delay: i * 0.1 }}
          />
        ))}

        {/* Pulse ring for core daemon */}
        <motion.circle
          cx={cx}
          cy={cy}
          r={40}
          fill="none"
          stroke="var(--brand-primary)"
          strokeWidth="1"
          animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0, 0.3] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>

      {/* Core Daemon Node */}
      <motion.div
        className="absolute w-20 h-20 rounded-[24px] bg-[var(--interactive-active)] border-2 border-[var(--brand-primary)] flex items-center justify-center shadow-2xl z-20"
        style={{ left: cx - 40, top: cy - 40 }}
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      >
        <Anchor className="text-[var(--brand-primary)]" size={32} />
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap">
           <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40">pd-daemon</span>
        </div>
      </motion.div>

      {/* Agent Nodes */}
      {displayAgents.map((agent, i) => {
        const angle = (i / displayAgents.length) * 2 * Math.PI;
        const x = cx + Math.cos(angle) * 200;
        const y = cy + Math.sin(angle) * 200;
        
        return (
          <motion.div
            key={agent.id}
            className="absolute z-10 group"
            style={{ left: x - 32, top: y - 32 }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 + i * 0.1 }}
            whileHover={{ scale: 1.1 }}
            onClick={() => onSelectAgent?.(agent.id)}
          >
            <div className="relative">
               <div className={`w-16 h-16 rounded-full bg-[var(--bg-overlay)] border-2 flex items-center justify-center shadow-xl transition-colors duration-300 ${agent.status === 'active' ? 'border-[var(--p-teal-500)] bg-[var(--p-teal-500)]/5' : 'border-[var(--border-subtle)]'}`}>
                  <SailorAgent size={32} />
               </div>
               
               {agent.status === 'active' && (
                 <motion.div 
                   className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--p-teal-400)] border-2 border-[var(--bg-surface)]"
                   animate={{ scale: [1, 1.2, 1] }}
                   transition={{ duration: 2, repeat: Infinity }}
                 />
               )}

               <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
                  <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-primary)]">{agent.label}</span>
                  <span className="text-[8px] font-bold opacity-40 uppercase tracking-widest">{agent.status}</span>
               </div>
            </div>
          </motion.div>
        );
      })}

      {/* Service Nodes */}
      {displayServices.map((service, i) => {
        const angle = (i / displayServices.length) * 2 * Math.PI + (Math.PI / 4);
        const x = cx + Math.cos(angle) * 320;
        const y = cy + Math.sin(angle) * 320;
        
        return (
          <motion.div
            key={service.id}
            className="absolute z-10"
            style={{ left: x - 24, top: y - 24 }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 0.6, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.1 }}
          >
            <div className="w-12 h-12 rounded-xl bg-[var(--bg-overlay)] border border-dashed border-[var(--p-blue-500)]/40 flex items-center justify-center">
               <Cpu size={20} className="text-[var(--p-blue-400)]" />
               <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-black uppercase tracking-widest opacity-40">
                  {service.label}
               </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  )
}
