import * as React from 'react'
import { motion } from 'framer-motion'
import { useDashboardStats } from '@/hooks/useDashboardStats'
import { useActivityStream } from '@/hooks/useActivityStream'
import { useTimeline } from '@/hooks/useTimeline'
import { LiveOrchestrationGraph } from '@/components/viz/LiveOrchestrationGraph'
import { Badge } from '@/components/ui/Badge'
import { Surface } from '@/components/ui/Surface'
import {
  Users, Zap, MessageSquare,
  History,
  Anchor, Radio, Search, Activity, Share2,
  Shield, RefreshCw
} from 'lucide-react'
import { Footer } from '@/components/layout/Footer'

// --- Unified Timeline Component ---

interface TimelineItem {
  id?: number | string
  type?: string
  timestamp?: number
  agentId?: string | null
  details?: string | null
}

function UnifiedTimeline() {
  const { activities: liveItems, connected, errorKind: liveErrorKind } = useActivityStream({ limit: 50 });
  const { events: historyItems, errorKind: historyErrorKind } = useTimeline({ limit: 100 });

  const allItems = React.useMemo<TimelineItem[]>(() => {
    const combined: TimelineItem[] = [...liveItems];
    const liveIds = new Set(liveItems.map(i => i.id || `${i.timestamp}-${i.type}`));

    historyItems.forEach(item => {
      const id = item.id || `${item.timestamp}-${item.type}`;
      if (!liveIds.has(id)) {
        combined.push(item);
      }
    });

    return combined.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }, [liveItems, historyItems]);

  const liveStatusLabel = connected
    ? 'Live'
    : liveErrorKind === 'network'
      ? 'Daemon Offline'
      : liveErrorKind
        ? 'Feed Error'
        : 'Offline'
  const emptyStateLabel = allItems.length === 0
    ? liveErrorKind === 'network'
      ? 'Daemon unreachable'
      : historyErrorKind
        ? 'Timeline unavailable'
        : 'Waiting for swarm signals...'
    : null

  return (
    <Surface depth="raised" radius="2xl" padding="none" className="flex flex-col h-full overflow-hidden font-sans relative">

      <Surface depth="inset" radius="none" padding="none" className="px-6 py-5 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 font-sans">

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
               {liveStatusLabel}
             </motion.span>
          </motion.div>
        </motion.div>
      </Surface>

      <motion.div className="flex-1 overflow-y-auto p-6 font-sans space-y-4">
        {allItems.length === 0 ? (
          <motion.div className="h-full flex flex-col items-center justify-center gap-4" style={{ color: 'var(--text-muted)' }}>
             <Radio size={64} className="opacity-20" />
             <motion.p className="text-sm font-black uppercase tracking-widest">{emptyStateLabel}</motion.p>
          </motion.div>
        ) : (
          allItems.map((item, i) => (
            <motion.div
              key={item.id || i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-start gap-4 group"
            >
               <motion.div className="pt-1 flex flex-col items-center gap-2 shrink-0">
                  <Surface depth="inset" radius="xl" padding="none" className="w-8 h-8 flex items-center justify-center group-hover:scale-110 transition-transform">

                     {item.type === 'note' ? <MessageSquare size={14} className="text-[var(--brand-secondary)]" /> :
                      item.type === 'port' ? <Anchor size={14} className="text-[var(--brand-secondary)]" /> :
                      <Zap size={14} className="text-[var(--brand-accent)]" />}
                  </Surface>
                  <motion.div className="w-[1px] h-full bg-gradient-to-b from-[var(--text-muted)] to-transparent opacity-20" />
               </motion.div>
               <motion.div className="flex-1 space-y-2">
                  <motion.div className="flex items-center justify-between">
                     <motion.span className="text-[10px] font-black uppercase tracking-widest text-[var(--brand-primary)]">{item.agentId || 'system'}</motion.span>
                     <motion.span className="text-[9px] font-mono" style={{ color: 'var(--text-muted)' }}>{item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : ''}</motion.span>
                  </motion.div>
                  <motion.p className="text-sm leading-relaxed m-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-secondary)' }}>{item.details}</motion.p>
               </motion.div>
            </motion.div>
          ))
        )}
      </motion.div>
    </Surface>
  )
}

export function DashboardPage() {
  const { stats, errorKind } = useDashboardStats()
  const latencyLabel = errorKind === 'network' ? 'offline' : '<5ms'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen flex flex-col font-sans selection:bg-[var(--brand-primary)] selection:text-white"
      style={{ background: 'var(--surface-base)' }}
    >
      {/* Hero Section */}
      <Surface depth="raised" radius="none" padding="none" className="py-14 px-6 sm:px-8 lg:px-10 relative overflow-hidden">

        <motion.div
          className="absolute top-0 right-0 w-[600px] h-[600px] rounded-full blur-[140px] opacity-[0.08] pointer-events-none"
          style={{ background: 'radial-gradient(circle, var(--brand-primary) 0%, transparent 70%)' }}
        />

        <motion.div className="max-w-7xl mx-auto flex flex-col items-center text-center gap-10 relative z-10">
           <motion.div className="max-w-3xl flex flex-col items-center gap-6">
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
           <motion.div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full max-w-5xl">
              {[
                { label: 'Active Agents', value: stats?.activeAgents || '0', icon: Users, color: 'var(--brand-secondary)' },
                { label: 'Harbors', value: stats?.activeHarbors || '0', icon: Shield, color: 'var(--brand-accent)' },
                { label: 'Port Claims', value: stats?.activePorts || '0', icon: Anchor, color: 'var(--brand-secondary)' },
                { label: 'Latency', value: latencyLabel, icon: Zap, color: 'var(--brand-accent)' }
              ].map((stat, i) => (
                <Surface
                  key={i}
                  depth="raised"
                  radius="2xl"
                  padding="none"
                  className="p-5 text-center space-y-2 group transition-all"
                >
                   <Surface depth="inset" radius="xl" padding="none" className="w-10 h-10 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                      <stat.icon size={20} style={{ color: stat.color }} />
                   </Surface>
                   {/* Inset value well */}
                   <motion.div
                     className="text-3xl font-display font-black leading-none py-2 px-4 rounded-xl mx-auto inline-block"
                     style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                   >{stat.value}</motion.div>
                   <motion.div className="text-[8px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{stat.label}</motion.div>
                </Surface>
              ))}
           </motion.div>
        </motion.div>
      </Surface>

      {/* Main Grid */}
      <motion.main id="main-content" className="flex-1 py-10 px-6 sm:px-8 lg:px-10 max-w-7xl mx-auto w-full font-sans">
        <motion.div className="grid lg:grid-cols-12 gap-5 min-h-[800px]">

           {/* Left Column: Visual Graph */}
           <motion.div className="lg:col-span-8 space-y-5">
              {/* 3D visualization wrapped in a tokenized elevation surface */}
              <Surface depth="raised" radius="2xl" padding="none" className="p-6 h-[600px] relative overflow-hidden group">

                 <motion.div className="absolute top-6 left-6 z-10 flex items-center gap-4">
                    <Badge variant="default" className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest">Network Topology</Badge>
                    <motion.div
                      className="flex items-center gap-2 px-3 py-1 rounded-full backdrop-blur-md"
                      style={{ background: 'var(--surface-sunken)', boxShadow: 'var(--shadow-pressed)' }}
                    >
                       <motion.div className="w-2 h-2 rounded-full bg-[var(--brand-secondary)] animate-pulse" />
                       <motion.span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Force-Directed</motion.span>
                    </motion.div>
                 </motion.div>
                 <LiveOrchestrationGraph />
              </Surface>

              {/* Control panels as raised surfaces */}
              <motion.div className="grid sm:grid-cols-2 gap-5">
                 <Surface depth="raised" radius="2xl" padding="none" className="p-6 space-y-4 group transition-colors">
                    <motion.div className="flex items-center gap-4">
                       <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
                          <Activity size={24} className="text-[var(--brand-secondary)]" />
                       </Surface>
                       <motion.h3 className="text-xl font-display font-black m-0">Harbor Health</motion.h3>
                    </motion.div>
                    <motion.p className="text-base m-0 leading-relaxed" style={{ color: 'var(--text-muted)' }}>Real-time verification of agent signatures and capability token expiry.</motion.p>
                 </Surface>
                 <Surface depth="raised" radius="2xl" padding="none" className="p-6 space-y-4 group transition-colors">
                    <motion.div className="flex items-center gap-4">
                       <Surface depth="inset" radius="2xl" padding="none" className="w-12 h-12 flex items-center justify-center">
                          <Search size={24} className="text-[var(--brand-accent)]" />
                       </Surface>
                       <motion.h3 className="text-xl font-display font-black m-0">Conflict Monitor</motion.h3>
                    </motion.div>
                    <motion.p className="text-base m-0 leading-relaxed" style={{ color: 'var(--text-muted)' }}>Instant detection of overlapping file claims or port allocation drifts.</motion.p>
                 </Surface>
              </motion.div>
           </motion.div>

           {/* Right Column: Unified Timeline */}
           <motion.div className="lg:col-span-4">
              <UnifiedTimeline />
           </motion.div>
        </motion.div>

        {/* Vision Callout */}
        <Surface depth="raised" radius="2xl" padding="none" className="mt-16 overflow-hidden">
          <motion.div
            className="p-6 flex flex-col items-center text-center gap-5 relative"
            initial={{ opacity: 0, scale: 0.98 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
          >
           <motion.div className="space-y-4 max-w-3xl relative z-10">
              <Badge variant="teal" className="px-6 py-2 text-[10px] font-black uppercase tracking-widest">Autonomous Maturity</Badge>
              <motion.h3 className="text-2xl sm:text-4xl font-display font-black tracking-tight leading-[0.95]" style={{ color: 'var(--text-primary)' }}>
                System <motion.span className="text-[var(--brand-secondary)]">Visibility.</motion.span>
              </motion.h3>
              <motion.p className="text-lg leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Multi-agent coordination is only as good as your ability to debug it. The HUD turns your local daemon into a transparent control plane, giving you the high-fidelity evidence needed to scale your swarm with confidence.
              </motion.p>
           </motion.div>

           <motion.div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-5xl">
              {[
                { label: 'Live Graph', icon: Share2 },
                { label: 'Radio Feed', icon: Zap },
                { label: 'Audit Trail', icon: History },
                { label: 'State Sync', icon: RefreshCw }
              ].map((item, i) => (
                <motion.div
                  key={i}
                  className="p-5 rounded-2xl flex flex-col items-center gap-4"
                  style={{ background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' }}
                >
                   <item.icon size={24} className="text-[var(--brand-primary)]" />
                   <motion.span className="text-[10px] font-black uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{item.label}</motion.span>
                </motion.div>
              ))}
           </motion.div>
          </motion.div>
        </Surface>
      </motion.main>

      <Footer />
    </motion.div>
  )
}
