import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDaemonData } from '@/hooks/useDaemonData'
import { useActivityStream } from '@/hooks/useActivityStream'
import { useTimeline } from '@/hooks/useTimeline'
import { LiveOrchestrationGraph } from '@/components/viz/LiveOrchestrationGraph'
import { AgentCard } from '@/components/viz/AgentCard'
import { WorkflowsTable } from '@/components/viz/WorkflowsTable'
import { Badge } from '@/components/ui/Badge'
import { 
  Lock, Users, Terminal, Zap, AlertCircle, 
  Network, GitBranch, MessageSquare, 
  History, 
  Skull, LifeBuoy, Anchor, Globe, Radio, Search, Activity, Cpu, Share2, ArrowRight, Layout
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

// --- Unified Timeline Component ---

function UnifiedTimeline() {
  const { activities: liveItems, connected } = useActivityStream({ limit: 50 });
  const { events: historyItems } = useTimeline({ limit: 100 });

  const allItems = React.useMemo(() => {
    const combined = [...liveItems];
    const liveIds = new Set(liveItems.map(i => i.id || `${i.timestamp}-${i.type}`));
    
    historyItems.forEach(item => {
      const id = item.id || `${item.timestamp}-${item.type}`;
      if (!liveIds.has(id)) {
        combined.push(item);
      }
    });

    return combined.sort((a, b) => b.timestamp - a.timestamp);
  }, [liveItems, historyItems]);

  return (
    <motion.div className="flex flex-col h-full bg-[var(--bg-surface)] rounded-[48px] border border-[var(--border-strong)] overflow-hidden shadow-2xl font-sans relative">
      <motion.div className="px-10 py-8 border-b border-[var(--border-subtle)] bg-[var(--bg-overlay)]/50 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 font-sans">
        <motion.div className="flex items-center gap-4 font-sans">
          <History size={24} className="text-[var(--brand-primary)]" />
          <div className="flex flex-col">
             <motion.h2 className="font-black text-[10px] uppercase tracking-[0.25em] text-[var(--text-primary)] font-sans m-0">Swarm Radio</motion.h2>
             <span className="text-[10px] font-bold opacity-40 uppercase tracking-widest">Unified Timeline</span>
          </div>
        </motion.div>
        <motion.div className="flex items-center gap-3 font-sans">
          <Badge variant="neutral" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest">v3.7 protocol</Badge>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-base)] border border-[var(--border-subtle)]">
             <motion.div className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--status-success)] pulse-active' : 'bg-[var(--status-error)]'}`} />
             <motion.span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] font-sans">
               {connected ? 'Live' : 'Offline'}
             </motion.span>
          </div>
        </motion.div>
      </motion.div>

      <div className="flex-1 overflow-y-auto p-10 font-sans space-y-6">
        {allItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-6 opacity-20">
             <Radio size={64} />
             <p className="text-sm font-black uppercase tracking-widest">Waiting for swarm signals...</p>
          </div>
        ) : (
          allItems.map((item, i) => (
            <motion.div 
              key={item.id || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-6 group"
            >
               <div className="pt-1 flex flex-col items-center gap-2 shrink-0">
                  <div className="w-8 h-8 rounded-xl bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex items-center justify-center group-hover:border-[var(--brand-primary)] transition-colors">
                     {item.type === 'note' ? <MessageSquare size={14} className="text-[var(--p-blue-400)]" /> : 
                      item.type === 'port' ? <Anchor size={14} className="text-[var(--p-teal-400)]" /> :
                      <Zap size={14} className="text-[var(--p-amber-400)]" />}
                  </div>
                  <div className="w-[1px] h-full bg-gradient-to-b from-[var(--border-subtle)] to-transparent" />
               </div>
               <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                     <span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">{item.identity || 'system'}</span>
                     <span className="text-[9px] font-mono opacity-40">{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <p className="text-sm leading-relaxed opacity-70 m-0 group-hover:opacity-100 transition-opacity">{item.content}</p>
               </div>
            </motion.div>
          ))
        )}
      </div>
    </motion.div>
  )
}

export function DashboardPage() {
  const { stats, loading } = useDaemonData()

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-[var(--bg-base)] flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
    >
      {/* Hero Section */}
      <motion.section 
        className="py-24 px-6 sm:px-8 lg:px-10 border-b relative overflow-hidden" 
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
      >
        <motion.div 
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none" 
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }} 
        />
        
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-16 relative z-10">
           <div className="max-w-2xl space-y-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em] shadow-xl">Live Telemetry</Badge>
              <motion.h1 
                className="text-6xl sm:text-8xl font-black tracking-tighter font-display leading-[0.95]"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                The Swarm <br />
                <motion.span className="text-[var(--brand-primary)]">Heads-Up Display.</motion.span>
              </motion.h1>
              <motion.p 
                className="text-2xl leading-relaxed opacity-70 font-medium"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1 }}
              >
                Visualize coordination in real-time. Monitor port health, harbor security, and agentic signaling across your entire mesh.
              </motion.p>
           </div>

           <div className="grid grid-cols-2 gap-6 shrink-0 w-full max-w-sm">
              {[
                { label: 'Active Agents', value: stats?.activeAgents || '0', icon: Users, color: 'var(--p-teal-400)' },
                { label: 'Harbors', value: stats?.activeHarbors || '0', icon: Shield, color: 'var(--p-amber-400)' },
                { label: 'Port Claims', value: stats?.activePorts || '0', icon: Anchor, color: 'var(--p-blue-400)' },
                { label: 'Latency', value: '<5ms', icon: Zap, color: 'var(--p-purple-400)' }
              ].map((stat, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-center space-y-2 group hover:border-[var(--brand-primary)] transition-all shadow-xl">
                   <div className="w-10 h-10 rounded-xl bg-[var(--bg-surface)] flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <stat.icon size={20} style={{ color: stat.color }} />
                   </div>
                   <div className="text-3xl font-display font-black leading-none">{stat.value}</div>
                   <div className="text-[8px] font-black uppercase tracking-widest opacity-40">{stat.label}</div>
                </div>
              ))}
           </div>
        </div>
      </motion.section>

      {/* Main Grid */}
      <motion.main className="flex-1 py-16 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <div className="grid lg:grid-cols-12 gap-10 min-h-[800px]">
           
           {/* Left Column: Visual Graph */}
           <div className="lg:col-span-8 space-y-10">
              <div className="bg-[var(--bg-surface)] rounded-[56px] border border-[var(--border-strong)] p-10 h-[600px] relative overflow-hidden shadow-2xl group">
                 <div className="absolute top-8 left-8 z-10 flex items-center gap-4">
                    <Badge variant="neutral" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest shadow-xl">Network Topology</Badge>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--bg-base)]/50 backdrop-blur-md border border-[var(--border-subtle)]">
                       <div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)] animate-pulse" />
                       <span className="text-[10px] font-bold opacity-60 uppercase">Force-Directed</span>
                    </div>
                 </div>
                 <LiveOrchestrationGraph />
              </div>

              <div className="grid sm:grid-cols-2 gap-10">
                 <div className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-6 shadow-xl group hover:border-[var(--brand-primary)] transition-colors">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-2xl bg-[var(--p-teal-500)]/10 flex items-center justify-center border border-[var(--p-teal-500)]/20">
                          <Activity size={24} className="text-[var(--p-teal-400)]" />
                       </div>
                       <h3 className="text-xl font-display font-black m-0">Harbor Health</h3>
                    </div>
                    <p className="text-base opacity-60 m-0 leading-relaxed">Real-time verification of agent signatures and capability token expiry.</p>
                 </div>
                 <div className="p-10 rounded-[48px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] space-y-6 shadow-xl group hover:border-[var(--p-amber-400)] transition-colors">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-2xl bg-[var(--p-amber-500)]/10 flex items-center justify-center border border-[var(--p-amber-500)]/20">
                          <Search size={24} className="text-[var(--p-amber-400)]" />
                       </div>
                       <h3 className="text-xl font-display font-black m-0">Conflict Monitor</h3>
                    </div>
                    <p className="text-base opacity-60 m-0 leading-relaxed">Instant detection of overlapping file claims or port allocation drifts.</p>
                 </div>
              </div>
           </div>

           {/* Right Column: Unified Timeline */}
           <div className="lg:col-span-4">
              <UnifiedTimeline />
           </div>
        </div>

        {/* Vision Callout */}
        <motion.div 
          className="mt-32 p-20 rounded-[80px] border border-dashed border-[var(--brand-primary)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-base)] flex flex-col items-center text-center gap-12 relative overflow-hidden"
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layout size={600} />
           </div>
           
           <div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest shadow-xl">Autonomous Maturity</Badge>
              <h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                System <span className="text-[var(--p-teal-400)]">Visibility.</span>
              </h3>
              <p className="text-2xl leading-relaxed opacity-70">
                Multi-agent coordination is only as good as your ability to debug it. The HUD turns your local daemon into a transparent control plane, giving you the high-fidelity evidence needed to scale your swarm with confidence.
              </p>
           </div>

           <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-5xl">
              {[
                { label: 'Live Graph', icon: Share2 },
                { label: 'Radio Feed', icon: Zap },
                { label: 'Audit Trail', icon: History },
                { label: 'State Sync', icon: RefreshCw }
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-[40px] bg-[var(--bg-overlay)] border border-[var(--border-subtle)] flex flex-col items-center gap-4">
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <span className="text-[10px] font-black uppercase tracking-widest opacity-60">{item.label}</span>
                </div>
              ))}
           </div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
