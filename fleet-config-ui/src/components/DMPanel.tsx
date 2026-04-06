import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { publishMessage, sendAgentMessage } from '../api';

interface Props {
  channels: string[];
  agents: string[];
  project?: string | null;
}

type DeliveryMode = 'channel' | 'agent';

export default function DMPanel({ channels, agents, project }: Props) {
  const [mode, setMode] = useState<DeliveryMode>('agent');
  const [channel, setChannel] = useState(channels[0] || '');
  const [agent, setAgent] = useState(agents[0] || '');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<Array<{ mode: DeliveryMode; target: string; message: string; ts: number }>>([]);

  useEffect(() => {
    if (channels.length > 0 && !channels.includes(channel)) {
      setChannel(channels[0]);
    }
  }, [channels, channel]);

  useEffect(() => {
    if (agents.length > 0 && !agents.includes(agent)) {
      setAgent(agents[0]);
    }
  }, [agents, agent]);

  useEffect(() => {
    if (mode === 'agent' && agents.length === 0) {
      setMode('channel');
    }
  }, [agents.length, mode]);

  const handleSend = async () => {
    const trimmed = message.trim();
    const target = mode === 'agent' ? agent : channel;
    if (!trimmed || !target) return;

    setSending(true);
    try {
      if (mode === 'agent') {
        await sendAgentMessage(agent, { content: trimmed, project: project ?? undefined, wake: true });
      } else {
        await publishMessage(channel, trimmed);
      }
      setSent(s => [...s.slice(-10), { mode, target, message: trimmed, ts: Date.now() }]);
      setMessage('');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="px-3 py-2" style={{ borderTop: '1px solid var(--pd-border)' }}>
      {/* Recent sent */}
      {sent.length > 0 && (
        <div className="mb-2 max-h-16 overflow-y-auto">
          {sent.slice(-3).map((s, i) => (
            <div key={i} className="text-[9px] opacity-40 flex items-center gap-1" style={{ color: 'var(--pd-text)' }}>
              <span className="font-mono" style={{ color: 'var(--pd-accent)' }}>
                {s.mode === 'agent' ? `@${s.target}` : `#${s.target}`}
              </span>
              <span className="truncate">{s.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 rounded p-0.5" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
          {(['agent', 'channel'] as DeliveryMode[]).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className="px-2 py-1 rounded text-[10px] font-semibold tracking-wide"
              style={{
                backgroundColor: mode === value ? 'var(--pd-accent-surface)' : 'transparent',
                color: mode === value ? 'var(--pd-accent)' : 'var(--pd-muted)',
              }}
            >
              {value === 'agent' ? 'Inbox Agent' : 'Publish Channel'}
            </button>
          ))}
        </div>
        <span className="text-[9px]" style={{ color: 'var(--pd-dim)' }}>
          {mode === 'agent' ? 'deliver + wake' : 'broadcast only'}
        </span>
      </div>

      <div className="flex gap-1.5">
        <select value={mode === 'agent' ? agent : channel} onChange={e => mode === 'agent' ? setAgent(e.target.value) : setChannel(e.target.value)}
          className="rounded px-1.5 py-1 text-[10px] font-mono flex-shrink-0 w-28"
          style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}>
          {(mode === 'agent' ? agents : channels).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={message} onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          placeholder={mode === 'agent' ? 'Ask the agent something...' : 'Publish to channel...'}
          className="flex-1 rounded px-2 py-1 text-[11px]"
          style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-text)', border: '1px solid var(--pd-border)' }} />
        <button onClick={handleSend} disabled={sending || !message.trim()}
          className="rounded px-2 py-1 opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--pd-accent)' }}>
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
