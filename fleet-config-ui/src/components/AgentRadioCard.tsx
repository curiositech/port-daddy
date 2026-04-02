import React from 'react';
import { Zap, Clock, Radio, Send, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AgentEvent {
  time: string;
  outcome: 'clean' | 'findings' | 'running';
  storyLine: string;
}

export interface AgentData {
  agentName: string;
  description: string;
  trigger: { type: 'event' | 'schedule'; value: string };
  eventHistory: AgentEvent[];
  listening: string[];
  broadcasting: string[];
  artifacts?: string[];
  consequences?: string[];
  status: 'active' | 'idle' | 'error';
}

export const agentColors: Record<string, string> = {
  gardener:      '#6EE7B7',
  qa:            '#60A5FA',
  spark:         '#F472B6',
  spider:        '#A78BFA',
  'test-hunter': '#FBBF24',
  documentarian: '#34D399',
  simplifier:    '#FB923C',
  cartographer:  '#818CF8',
};

export const channelPrefixColors: Record<string, string> = {
  git:           '#F87171',
  qa:            '#60A5FA',
  spark:         '#FB7185',
  spider:        '#A78BFA',
  test:          '#FBBF24',
  documentarian: '#34D399',
  docs:          '#10B981',
  deploy:        '#C084FC',
  slack:         '#F472B6',
  user:          '#4ADE80',
  ai:            '#38BDF8',
};

export const ColoredToken: React.FC<{ text: string; isAgent?: boolean }> = ({ text, isAgent }) => {
  if (isAgent) {
    const color = agentColors[text] || 'var(--pd-text)';
    return <span style={{ color }}>{text}</span>;
  }
  const parts = text.split(':');
  return (
    <>
      {parts.map((part, idx) => {
        const color = channelPrefixColors[part] || agentColors[part] || 'var(--pd-text)';
        return (
          <span key={idx}>
            <span style={{ color }}>{part}</span>
            {idx < parts.length - 1 && <span style={{ color: 'var(--pd-text)', opacity: 0.4 }}>:</span>}
          </span>
        );
      })}
    </>
  );
};

interface AgentRadioCardProps extends AgentData {
  onConfigure?: () => void;
}

const AgentRadioCard: React.FC<AgentRadioCardProps> = ({
  agentName,
  description,
  trigger,
  eventHistory,
  listening,
  broadcasting,
  artifacts = [],
  consequences = [],
  status,
  onConfigure,
}) => {
  const outcomeColors = {
    clean:    'text-green-500',
    findings: 'text-red-500',
    running:  'text-amber-500',
  };
  const statusColors = {
    active: { bg: '#10B981', label: 'ACTIVE' },
    idle:   { bg: '#F59E0B', label: 'IDLE'   },
    error:  { bg: '#EF4444', label: 'ERROR'  },
  };
  const currentStatus = statusColors[status];

  return (
    <div
      className="w-full rounded-lg border p-5 shadow-lg flex flex-col relative"
      style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
    >
      {/* Configure Button */}
      <button
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all duration-300"
        style={{ backgroundColor: '#CC3D2E', color: '#D4C5A9' }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 20px rgba(204,61,46,0.6)')}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
        onClick={onConfigure}
      >
        <Settings size={14} />
        <span>Config</span>
      </button>

      {/* Status */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: currentStatus.bg }} />
        <span className="text-[9px] font-bold tracking-wider" style={{ backgroundColor: currentStatus.bg + '22', color: currentStatus.bg, padding: '1px 6px', borderRadius: 3 }}>
          {currentStatus.label}
        </span>
      </div>

      {/* Header */}
      <div className="mb-4">
        <h2 className="font-mono text-lg font-bold mb-1" style={{ color: agentColors[agentName] || 'var(--pd-text)' }}>
          {agentName}
        </h2>
        <p className="text-xs opacity-60" style={{ color: 'var(--pd-text)' }}>{description}</p>
      </div>

      {/* Trigger Badge */}
      <div className="mb-3">
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
          style={{ backgroundColor: 'var(--pd-surface-2)', borderColor: 'var(--pd-border)', color: 'var(--pd-text)' }}
        >
          {trigger.type === 'event'
            ? <Zap size={12} style={{ color: '#FBBF24' }} />
            : <Clock size={12} style={{ color: '#34D399' }} />}
          <span>{trigger.type === 'event' ? 'fires when' : 'fires every'}: </span>
          <ColoredToken text={trigger.value} />
        </div>
      </div>

      {/* Event History Timeline */}
      <div className="mb-4 space-y-2">
        {eventHistory.slice(0, 3).map((event, idx) => (
          <div key={idx} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn('w-2 h-2 rounded-full shrink-0 mt-1.5',
                  event.outcome === 'clean'    && 'bg-green-500',
                  event.outcome === 'findings' && 'bg-red-500',
                  event.outcome === 'running'  && 'bg-amber-500',
                )}
              />
              {idx < Math.min(eventHistory.length, 3) - 1 && (
                <div className="w-px flex-1 mt-1" style={{ backgroundColor: 'var(--pd-border)' }} />
              )}
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 text-xs mb-0.5">
                <span style={{ color: 'var(--pd-text)' }} className="opacity-60">{event.time}</span>
                <span style={{ color: 'var(--pd-text)' }} className="opacity-40">·</span>
                <span className={cn('font-semibold uppercase text-[10px]', outcomeColors[event.outcome])}>
                  {event.outcome}
                </span>
              </div>
              <p className="text-xs italic opacity-60 line-clamp-2" style={{ color: 'var(--pd-text)' }}>
                {event.storyLine}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Channels */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Radio size={13} style={{ color: '#60A5FA' }} />
            <span className="text-xs font-semibold" style={{ color: '#8B9DAF' }}>Listening</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {listening.map((ch, i) => (
              <span key={i} className="inline-block px-2 py-0.5 rounded text-xs font-mono"
                style={{ backgroundColor: 'var(--pd-surface-2)', border: '1px solid var(--pd-border)' }}>
                <ColoredToken text={ch} />
              </span>
            ))}
            {listening.length === 0 && (
              <span className="text-xs opacity-40" style={{ color: 'var(--pd-text)' }}>starts on schedule</span>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Send size={13} style={{ color: '#F472B6' }} />
            <span className="text-xs font-semibold" style={{ color: '#B88AA3' }}>Broadcasting</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {broadcasting.map((ch, i) => (
              <span key={i} className="inline-block px-2 py-0.5 rounded text-xs font-mono"
                style={{ backgroundColor: 'var(--pd-surface-2)', border: '1px solid var(--pd-border)' }}>
                <ColoredToken text={ch} />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Artifacts */}
      {artifacts.length > 0 && (
        <div className="mb-3 pb-3 border-b" style={{ borderColor: 'var(--pd-border)' }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: '#A78BFA' }}>Artifacts</div>
          {artifacts.map((f, i) => (
            <div key={i} className="text-xs font-mono opacity-60" style={{ color: 'var(--pd-text)' }}>{f}</div>
          ))}
        </div>
      )}

      {/* Consequences */}
      {consequences.length > 0 && (
        <div className="mb-1">
          <div className="text-xs font-semibold mb-1.5" style={{ color: '#FB923C' }}>Side Effects</div>
          {consequences.map((c, i) => (
            <div key={i} className="text-xs opacity-70 flex items-center gap-1.5" style={{ color: 'var(--pd-text)' }}>
              <span style={{ color: '#CC3D2E' }}>→</span>{c}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgentRadioCard;
