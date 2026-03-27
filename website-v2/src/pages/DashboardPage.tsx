import * as React from 'react'
import { motion } from 'framer-motion'
import { useDaemonData } from '@/hooks/useDaemonData'
import { useActivityStream } from '@/hooks/useActivityStream'
import { useTimeline } from '@/hooks/useTimeline'
import { LiveOrchestrationGraph } from '@/components/viz/LiveOrchestrationGraph'
import { Badge } from '@/components/ui/Badge'
import {
  Users, Zap, MessageSquare,
  History,
  Anchor, Radio, Search, Activity, Share2, Layout,
  Shield, RefreshCw
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
    <motion.div
      className="flex flex-col h-full rounded-2xl overflow-hidden font-sans relative"
      style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
    >
      <motion.div
        className="px-10 py-8 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 font-sans"
        style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
      >
        <motion.div className="flex items-center gap-4 font-sans">
          <History size={24} className="text-[var(--brand-primary)]" />
          <motion.div className="flex flex-col">
             <motion.h2 className="font-black text-[10px] uppercase tracking-[0.25em] text-[var(--text-primary)] font-sans m-0">Swarm Radio</motion.h2>
             <motion.span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Unified Timeline</motion.span>
          </motion.div>
        </motion.div>
        <motion.div className="flex items-center gap-3 font-sans">
          <Badge variant="default" className="px-3 py-1 text-[8px] font-black uppercase tracking-widest">v3.7 protocol</Badge>
          <motion.div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
          >
             <motion.div className={`w-2 h-2 rounded-full ${connected ? 'bg-[var(--status-success)] pulse-active' : 'bg-[var(--status-error)]'}`} />
             <motion.span className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] font-sans">
               {connected ? 'Live' : 'Offline'}
             </motion.span>
          </motion.div>
        </motion.div>
      </motion.div>

      <motion.div className="flex-1 overflow-y-auto p-10 font-sans space-y-6">
        {allItems.length === 0 ? (
          <motion.div className="h-full flex flex-col items-center justify-center gap-6" style={{ color: 'var(--text-muted)' }}>
             <Radio size={64} className="opacity-20" />
             <motion.p className="text-sm font-black uppercase tracking-widest">Waiting for swarm signals...</motion.p>
          </motion.div>
        ) : (
          allItems.map((item, i) => (
            <motion.div
              key={item.id || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-6 group"
            >
               <motion.div className="pt-1 flex flex-col items-center gap-2 shrink-0">
                  <motion.div
                    className="w-8 h-8 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"
                    style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                  >
                     {item.type === 'note' ? <MessageSquare size={14} className="text-[var(--p-blue-400)]" /> :
                      item.type === 'port' ? <Anchor size={14} className="text-[var(--p-teal-400)]" /> :
                      <Zap size={14} className="text-[var(--brand-accent)]" />}
                  </motion.div>
                  <motion.div className="w-[1px] h-full bg-gradient-to-b from-[var(--text-muted)] to-transparent opacity-20" />
               </motion.div>
               <motion.div className="flex-1 space-y-2">
                  <motion.div className="flex items-center justify-between">
                     <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">{item.agentId || 'system'}</motion.span>
                     <motion.span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{new Date(item.timestamp).toLocaleTimeString()}</motion.span>
                  </motion.div>
                  <motion.p className="text-sm leading-relaxed m-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>{item.details}</motion.p>
               </motion.div>
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  )
}

export function DashboardPage() {
  const { data: stats } = useDaemonData<any>('/stats')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col pt-[var(--nav-height)] font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Hero Section */}
      <motion.section
        className="py-24 px-6 sm:px-8 lg:px-10 relative overflow-hidden"
        style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
      >
        <motion.div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <motion.div className="max-w-7xl mx-auto flex flex-col items-center text-center gap-16 relative z-10">
           <motion.div className="max-w-3xl flex flex-col items-center gap-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-[0.25em]">Live Telemetry</Badge>
              <motion.h1
                className="text-6xl sm:text-8xl font-black tracking-tighter font-display leading-[0.95] m-0"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                The Swarm <br />
                <motion.span className="text-[var(--brand-primary)]">Heads-Up Display.</motion.span>
              </motion.h1>
              <motion.p
                className="text-2xl leading-relaxed font-medium"
                style={{ color: 'var(--text-secondary)' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1 }}
              >
                Visualize coordination in real-time. Monitor port health, harbor security, and agentic signaling across your entire mesh.
              </motion.p>
           </motion.div>

           {/* Stat cards with raised surfaces and inset value wells */}
           <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-6 w-full max-w-5xl">
              {[
                { label: 'Active Agents', value: stats?.activeAgents || '0', icon: Users, color: 'var(--p-teal-400)' },
                { label: 'Harbors', value: stats?.activeHarbors || '0', icon: Shield, color: 'var(--brand-accent)' },
                { label: 'Port Claims', value: stats?.activePorts || '0', icon: Anchor, color: 'var(--p-blue-400)' },
                { label: 'Latency', value: '<5ms', icon: Zap, color: 'var(--p-purple-400)' }
              ].map((stat, i) => (
                <motion.div
                  key={i}
                  className="p-8 rounded-2xl text-center space-y-2 group transition-all"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                >
                   <motion.div
                     className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                   >
                      <stat.icon size={20} style={{ color: stat.color }} />
                   </motion.div>
                   {/* Inset value well */}
                   <motion.div
                     className="text-3xl font-display font-black leading-none py-2 px-4 rounded-xl mx-auto inline-block"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                   >{stat.value}</motion.div>
                   <motion.div className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{stat.label}</motion.div>
                </motion.div>
              ))}
           </motion.div>
        </motion.div>
      </motion.section>

      {/* Main Grid */}
      <motion.main id="main-content" className="flex-1 py-16 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <motion.div className="grid lg:grid-cols-12 gap-10 min-h-[800px]">

           {/* Left Column: Visual Graph */}
           <motion.div className="lg:col-span-8 space-y-10">
              {/* 3D visualization wrapped in neumorphic surface */}
              <motion.div
                className="rounded-2xl p-10 h-[600px] relative overflow-hidden group"
                style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
              >
                 <motion.div className="absolute top-8 left-8 z-10 flex items-center gap-4">
                    <Badge variant="default" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest">Network Topology</Badge>
                    <motion.div
                      className="flex items-center gap-2 px-3 py-1 rounded-full backdrop-blur-md"
                      style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                    >
                       <motion.div className="w-2 h-2 rounded-full bg-[var(--p-teal-400)] animate-pulse" />
                       <motion.span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Force-Directed</motion.span>
                    </motion.div>
                 </motion.div>
                 <LiveOrchestrationGraph />
              </motion.div>

              {/* Control panels as raised surfaces */}
              <motion.div className="grid sm:grid-cols-2 gap-10">
                 <motion.div
                   className="p-10 rounded-2xl space-y-6 group transition-colors"
                   style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                 >
                    <motion.div className="flex items-center gap-4">
                       <motion.div
                         className="w-12 h-12 rounded-2xl flex items-center justify-center"
                         style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                       >
                          <Activity size={24} className="text-[var(--p-teal-400)]" />
                       </motion.div>
                       <motion.h3 className="text-xl font-display font-black m-0">Harbor Health</motion.h3>
                    </motion.div>
                    <motion.p className="text-base m-0 leading-relaxed" style={{ color: 'var(--text-muted)' }}>Real-time verification of agent signatures and capability token expiry.</motion.p>
                 </motion.div>
                 <motion.div
                   className="p-10 rounded-2xl space-y-6 group transition-colors"
                   style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
                 >
                    <motion.div className="flex items-center gap-4">
                       <motion.div
                         className="w-12 h-12 rounded-2xl flex items-center justify-center"
                         style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-inset)' }}
                       >
                          <Search size={24} className="text-[var(--brand-accent)]" />
                       </motion.div>
                       <motion.h3 className="text-xl font-display font-black m-0">Conflict Monitor</motion.h3>
                    </motion.div>
                    <motion.p className="text-base m-0 leading-relaxed" style={{ color: 'var(--text-muted)' }}>Instant detection of overlapping file claims or port allocation drifts.</motion.p>
                 </motion.div>
              </motion.div>
           </motion.div>

           {/* Right Column: Unified Timeline */}
           <motion.div className="lg:col-span-4">
              <UnifiedTimeline />
           </motion.div>
        </motion.div>

        {/* Vision Callout */}
        <motion.div
          className="mt-32 p-20 rounded-2xl flex flex-col items-center text-center gap-12 relative overflow-hidden"
          style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-raised)' }}
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
        >
           <motion.div className="absolute top-0 right-0 p-10 opacity-[0.02] pointer-events-none">
              <Layout size={600} />
           </motion.div>

           <motion.div className="space-y-6 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
              <motion.h3 className="text-4xl sm:text-7xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                System <motion.span className="text-[var(--p-teal-400)]">Visibility.</motion.span>
              </motion.h3>
              <motion.p className="text-2xl leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Multi-agent coordination is only as good as your ability to debug it. The HUD turns your local daemon into a transparent control plane, giving you the high-fidelity evidence needed to scale your swarm with confidence.
              </motion.p>
           </motion.div>

           <motion.div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full max-w-5xl">
              {[
                { label: 'Live Graph', icon: Share2 },
                { label: 'Radio Feed', icon: Zap },
                { label: 'Audit Trail', icon: History },
                { label: 'State Sync', icon: RefreshCw }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-8 rounded-2xl flex flex-col items-center gap-4"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <motion.span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</motion.span>
                </motion.div>
              ))}
           </motion.div>
        </motion.div>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
