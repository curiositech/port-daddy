import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { agentColor } from '../types';
import { extractMentionedPaths } from '../fileMentions';
import FileActionLinks from './FileActionLinks';

export interface ChannelEvent {
  id: string;
  ts: string;
  timestamp?: number;
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
  projectDir?: string;
  onChannelClick: (ch: string) => void;
  layout?: 'rail' | 'page';
}

export default function ChannelLog({ events, selectedAgent, selectedChannel, projectDir, onChannelClick, layout = 'rail' }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const visibleEvents = events.filter((event) => {
    const trimmed = event.message.trim();
    if (!trimmed) return false;
    const normalized = trimmed.toLowerCase();
    if (['ok', 'done', 'success', 'connected', 'streaming', 'heartbeat'].includes(normalized)) return false;
    if (event.publisher === 'system' && trimmed.length < 24) return false;
    return true;
  });
  const isPage = layout === 'page';

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleEvents.length]);

  const isVisible = (ev: ChannelEvent) => {
    if (selectedAgent && ev.publisher !== selectedAgent && !ev.triggered.includes(selectedAgent)) return false;
    if (selectedChannel && ev.channel !== selectedChannel) return false;
    return true;
  };

  return (
    <div
      className={`flex h-full flex-col overflow-hidden ${isPage ? 'pd-card' : ''}`}
      style={{ backgroundColor: isPage ? 'var(--pd-surface)' : 'var(--pd-surface-3)' }}
    >
      <div className={`${isPage ? 'px-5 py-4' : 'px-4 py-2.5'} flex items-center justify-between gap-3 flex-shrink-0`} style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[11px] font-semibold tracking-wider" style={{ color: 'var(--pd-muted)' }}>
            {isPage ? 'MESSAGE TRAFFIC' : 'CHANNEL LOG'}
          </div>
          {isPage ? (
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              Non-empty channel activity
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {(selectedAgent || selectedChannel) && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}>
              {selectedAgent ?? selectedChannel}
            </span>
          )}
          <span className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
            {visibleEvents.length} items
          </span>
        </div>
      </div>

      <div className={`${isPage ? 'px-5 py-4' : 'px-3 py-2'} flex-1 overflow-y-auto flex flex-col gap-2`}>
        <AnimatePresence initial={false}>
          {visibleEvents.length === 0 ? (
            <div className="text-center py-8 text-sm" style={{ color: 'var(--pd-muted)' }}>
              No non-empty channel messages yet.
            </div>
          ) : visibleEvents.map(ev => {
            const visible = isVisible(ev);
            const color = agentColor(ev.publisher);
            const mentionedFiles = isPage ? extractMentionedPaths(ev.message, 4) : [];
            return (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: visible ? 1 : 0.15, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className={`leading-relaxed rounded-xl border ${isPage ? 'px-4 py-3 text-[12px]' : 'text-[11px] px-3 py-2'}`}
                style={{ borderColor: 'var(--pd-border)', backgroundColor: isPage ? 'var(--pd-bg)' : 'color-mix(in srgb, var(--pd-surface) 78%, transparent)' }}
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-1">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--pd-dim)' }}>{ev.ts}</span>
                  <span className="font-mono font-semibold" style={{ color }}>{ev.publisher}</span>
                  <span style={{ color: 'var(--pd-muted)' }}>→</span>
                  <button
                    onClick={() => onChannelClick(ev.channel)}
                    className="font-mono text-[10px] hover:opacity-100"
                    style={{ color: 'var(--pd-accent)', opacity: selectedChannel === ev.channel ? 1 : 0.82 }}
                  >
                    #{ev.channel.replace(/_/g, ' ')}
                  </button>
                  {ev.outcome === 'findings' && (
                    <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)' }}>
                      FINDINGS
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--pd-text)' }}>
                  {ev.message}
                </div>
                {mentionedFiles.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {mentionedFiles.map((filePath) => (
                      <FileActionLinks
                        key={`${ev.id}-${filePath}`}
                        filePath={filePath}
                        projectDir={projectDir}
                        compact
                      />
                    ))}
                  </div>
                ) : null}
                {ev.triggered.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
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
