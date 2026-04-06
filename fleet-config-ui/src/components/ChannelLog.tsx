import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { agentColor } from '../types';

export interface ChannelEvent {
  id: string;
  ts: string;
  channel: string;
  publisher: string;
  outcome: 'clean' | 'findings';
  message: string;
  triggered: string[];
}

interface Props {
  events: ChannelEvent[];
  selectedAgent: string | null;
  selectedChannel: string | null;
  onChannelClick: (ch: string) => void;
}

export default function ChannelLog({ events, selectedAgent, selectedChannel, onChannelClick }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const isVisible = (ev: ChannelEvent) => {
    if (selectedAgent && ev.publisher !== selectedAgent && !ev.triggered.includes(selectedAgent)) return false;
    if (selectedChannel && ev.channel !== selectedChannel) return false;
    return true;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ backgroundColor: 'var(--pd-surface-3)' }}>
      <div className="px-4 py-2.5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <span className="text-[11px] font-semibold tracking-wider" style={{ color: 'var(--pd-muted)' }}>CHANNEL LOG</span>
        {(selectedAgent || selectedChannel) && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
            {selectedAgent ?? selectedChannel}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5">
        <AnimatePresence initial={false}>
          {events.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--pd-muted)' }}>
              Waiting for events...
            </div>
          ) : events.map(ev => {
            const visible = isVisible(ev);
            const color = agentColor(ev.publisher);
            return (
              <motion.div key={ev.id}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: visible ? 1 : 0.15, x: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }} className="text-[11px] leading-relaxed">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--pd-dim)' }}>{ev.ts}</span>
                  <span className="font-mono font-semibold" style={{ color }}>{ev.publisher}</span>
                  <span style={{ color: 'var(--pd-muted)' }}>→</span>
                  <button onClick={() => onChannelClick(ev.channel)} className="font-mono text-[10px] hover:opacity-100"
                    style={{ color: 'var(--pd-accent)', opacity: selectedChannel === ev.channel ? 1 : 0.82 }}>
                    #{ev.channel.replace(/_/g, ' ')}
                  </button>
                </div>
                <div className="pl-4" style={{ color: 'var(--pd-muted)' }}>
                  {ev.outcome === 'findings' && (
                    <span className="text-[9px] font-bold mr-1.5 px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)' }}>FINDINGS</span>
                  )}
                  {ev.message}
                </div>
                {ev.triggered.length > 0 && (
                  <div className="pl-4 mt-0.5 flex items-center gap-1">
                    <span className="text-[9px]" style={{ color: 'var(--pd-dim)' }}>triggered</span>
                    {ev.triggered.map(a => <span key={a} className="text-[9px] font-mono" style={{ color: agentColor(a) }}>{a}</span>)}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
