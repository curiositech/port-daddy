import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useActivityStream, type Activity as LiveActivity } from '@/hooks/useActivityStream'
import { useTimeline, type TimelineEvent } from '@/hooks/useTimeline'
import { Activity, Zap, Lock, User, MessageSquare, Terminal, History, Search, Radio, LifeBuoy, Skull, type LucideIcon } from 'lucide-react'

type ActivityItemModel = LiveActivity | TimelineEvent

const ICON_MAP: Record<string, LucideIcon> = {
  'service.claim': Terminal,
  'service.release': Terminal,
  'lock.acquire': Lock,
  'lock.release': Lock,
  'agent.register': User,
  'agent.unregister': User,
  'message.publish': Radio,
  'note': MessageSquare,
  'handoff': Zap,
  'agent.salvage': LifeBuoy,
}

function activityContent(activity: ActivityItemModel) {
  if ('content' in activity && activity.content) return activity.content
  if (activity.details) return activity.details
  if ('message' in activity && activity.message) return activity.message
  if (!('payload' in activity) || activity.payload == null) return null
  return typeof activity.payload === 'string' ? activity.payload : JSON.stringify(activity.payload)
}

function ActivityItem({ activity, isNote }: { activity: ActivityItemModel; isNote?: boolean }) {
  const type = activity.type ?? ''
  const isError = type.includes('error') || type.includes('fail') || type.includes('dead');
  const isSalvage = type.includes('salvage');
  const isDeath = type === 'agent.unregister' || type.includes('dead');
  const timestamp = activity.timestamp ?? ('createdAt' in activity ? activity.createdAt : undefined)
  
  const Icon = isNote ? MessageSquare : isSalvage ? LifeBuoy : isDeath ? Skull : (ICON_MAP[type] || Zap);
  const time = timestamp ? new Date(timestamp).toLocaleTimeString() : ''
  
  const content = activityContent(activity);

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`flex items-start gap-4 p-3 rounded-xl hover:bg-[var(--interactive-hover)] transition-all border border-transparent hover:border-[var(--border-subtle)] font-sans ${isNote ? 'bg-[var(--surface-overlay)]/50' : ''}`}
    >
      <motion.div className={`p-2 rounded-lg shrink-0 ${isNote ? 'bg-[var(--brand-accent)]/10 text-[var(--brand-accent)]' : isError ? 'bg-[var(--status-error)]/10 text-[var(--status-error)]' : 'bg-[var(--surface-overlay)] text-[var(--brand-primary)]'}`}>
        <Icon size={16} />
      </motion.div>
      <motion.div className="flex-1 min-w-0 font-sans">
        <motion.div className="flex items-center justify-between gap-2 mb-0.5 font-sans">
          <motion.span className={`text-[length:var(--type-meta-size,14px)] font-black uppercase tracking-wider font-sans ${isNote ? 'text-[var(--brand-accent)]' : 'text-[var(--text-muted)]'}`}>
            {'source' in activity && activity.source === 'note' ? `Note` : type}
          </motion.span>
          <motion.span className="text-[length:var(--type-meta-size,14px)] font-mono text-[var(--text-muted)] shrink-0 opacity-40">
            {time}
          </motion.span>
        </motion.div>
        <motion.p className={`text-sm font-medium leading-tight font-sans ${isNote ? 'italic text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'}`}>
          {content}
        </motion.p>
        {(activity.agentId || ('sender' in activity && activity.sender)) && (
          <motion.div className="text-[9px] font-mono text-[var(--text-muted)] mt-1 uppercase tracking-tighter opacity-40">
            {activity.agentId ? `Agent: ${activity.agentId}` : `From: ${'sender' in activity ? activity.sender : ''}`}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  )
}

export function ActivityFeed() {
  const [mode, setMode] = React.useState<'live' | 'history'>('live');
  const { activities: liveActivities, connected, errorKind: liveErrorKind } = useActivityStream({ limit: 20 });
  const { events: historyEvents, errorKind: historyErrorKind } = useTimeline({ limit: 50 });

  const displayItems: ActivityItemModel[] = mode === 'live' ? liveActivities : historyEvents;
  const liveSignalLabel = connected
    ? 'Signal Active'
    : liveErrorKind === 'network'
      ? 'Daemon Offline'
      : liveErrorKind === 'configuration'
        ? 'Select Endpoint'
      : liveErrorKind
        ? 'Feed Error'
        : 'Radio Silent'
  const emptyStateLabel = mode === 'live' && liveErrorKind === 'network'
    ? 'Daemon unreachable'
    : mode === 'live' && liveErrorKind === 'configuration'
      ? 'Choose a daemon endpoint'
      : mode === 'history' && historyErrorKind
        ? 'Timeline unavailable'
        : 'No activity detected'

  return (
    <motion.div className="flex flex-col h-full bg-[var(--surface-raised)] rounded-3xl border border-[var(--border-default)] overflow-hidden shadow-2xl font-sans">
      <motion.div className="px-5 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-overlay)] font-sans">
        <motion.div className="flex items-center gap-2 font-sans">
          {mode === 'live' ? <Activity size={18} className="text-[var(--brand-primary)]" /> : <History size={18} className="text-[var(--brand-accent)]" />}
          <motion.h2 className="font-bold text-xs uppercase tracking-[0.2em] text-[var(--text-primary)] font-sans">
            {mode === 'live' ? 'Live Radio' : 'Chronicle'}
          </motion.h2>
        </motion.div>
        
        <motion.div className="flex bg-[var(--surface-base)] p-1 rounded-lg border border-[var(--border-subtle)] font-sans">
          <motion.button 
            onClick={() => setMode('live')}
            className={`px-3 py-1 rounded-md text-[length:var(--type-meta-size,14px)] font-black uppercase transition-all font-sans ${mode === 'live' ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            Live
          </motion.button>
          <motion.button 
            onClick={() => setMode('history')}
            className={`px-3 py-1 rounded-md text-[length:var(--type-meta-size,14px)] font-black uppercase transition-all font-sans ${mode === 'history' ? 'bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            History
          </motion.button>
        </motion.div>
      </motion.div>

      {mode === 'live' && (
        <motion.div className="px-5 py-2 bg-[var(--surface-overlay)]/50 border-b border-[var(--border-subtle)] flex items-center justify-between font-sans">
          <motion.div className="flex items-center gap-1.5 font-sans">
            <motion.div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[var(--status-success)] animate-pulse' : 'bg-[var(--status-error)]'}`} />
            <motion.span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-muted)] font-sans">
              {liveSignalLabel}
            </motion.span>
          </motion.div>
        </motion.div>
      )}
      
      <motion.div className="flex-1 overflow-y-auto p-4 scrollbar-hide font-sans">
        <motion.div className="flex flex-col gap-2 font-sans">
          <AnimatePresence initial={false}>
            {displayItems.map((a, idx) => (
              <ActivityItem key={a.id || idx} activity={a} isNote={'source' in a && a.source === 'note'} />
            ))}
          </AnimatePresence>
          {displayItems.length === 0 && (
            <motion.div className="py-20 text-center opacity-30 font-sans">
              <Search size={32} className="mx-auto mb-4" />
              <motion.p className="text-[length:var(--type-meta-size,14px)] font-black uppercase tracking-widest font-sans">{emptyStateLabel}</motion.p>
            </motion.div>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  )
}
