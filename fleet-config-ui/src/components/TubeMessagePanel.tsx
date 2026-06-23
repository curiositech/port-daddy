/**
 * TubeMessagePanel — live channel browser + publish console.
 *
 * Routes used:
 *   GET  /msg                       — list channels with message counts
 *   GET  /msg/:channel              — channel message history (+ ?limit=&after=)
 *   POST /msg/:channel              — publish a message
 *
 * This complements TubeConsolePanel (which is fleet-config-scoped) by providing
 * a standalone global-scoped channel browser for operators who aren't in a
 * specific project context.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { getDaemonUrl } from '../api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelSummary {
  channel: string;
  count: number;
  lastMessage: number;
}

interface ChannelMessage {
  id: number;
  sender: string | null;
  payload: unknown;
  createdAt: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function daemonBase(): string {
  // Single source of truth for the daemon URL: api.ts owns env discovery,
  // the persisted choice, and the canonical fallback. Never re-derive it here.
  return getDaemonUrl();
}

async function listChannels(limit = 50): Promise<ChannelSummary[]> {
  const res = await fetch(`${daemonBase()}/msg?limit=${limit}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json() as { success: boolean; channels?: ChannelSummary[] };
  return data.channels ?? [];
}

async function getMessages(channel: string, limit = 30, after?: number): Promise<ChannelMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (typeof after === 'number' && Number.isFinite(after)) params.set('after', String(after));
  const res = await fetch(`${daemonBase()}/msg/${encodeURIComponent(channel)}?${params}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json() as { messages?: ChannelMessage[] };
  return data.messages ?? [];
}

async function publishMessage(channel: string, payload: string): Promise<void> {
  let body: unknown = payload;
  try { body = JSON.parse(payload); } catch { /* send as string */ }
  const res = await fetch(`${daemonBase()}/msg/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: body, sender: 'fleet-ui' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `${res.status} ${res.statusText}`);
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RelativeTime({ ts }: { ts: number }) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return <>{diff}s ago</>;
  if (diff < 3600) return <>{Math.floor(diff / 60)}m ago</>;
  if (diff < 86400) return <>{Math.floor(diff / 3600)}h ago</>;
  return <>{Math.floor(diff / 86400)}d ago</>;
}

function renderPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  try { return JSON.stringify(payload, null, 2); } catch { return String(payload); }
}

function MessageBubble({ msg }: { msg: ChannelMessage }) {
  const [open, setOpen] = useState(false);
  const body = renderPayload(msg.payload);
  const isLong = body.length > 120;

  return (
    <div className="rounded-md border px-3 py-2" style={{ backgroundColor: 'var(--pd-bg)', borderColor: 'var(--pd-border)' }}>
      <div className="flex items-center justify-between gap-2 text-sm" style={{ color: 'var(--pd-dim)' }}>
        <span className="font-mono">{msg.sender ?? 'unknown'}</span>
        <span><RelativeTime ts={msg.createdAt} /></span>
      </div>
      <div
        className="mt-1 text-sm font-mono break-all whitespace-pre-wrap"
        style={{ color: 'var(--pd-text)', maxHeight: open ? undefined : isLong ? '4rem' : undefined, overflow: open ? 'visible' : 'hidden' }}
      >
        {body}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="mt-1 text-sm font-semibold"
          style={{ color: 'var(--pd-accent)' }}
        >
          {open ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  );
}

// ─── ChannelList ──────────────────────────────────────────────────────────────

interface ChannelListProps {
  channels: ChannelSummary[];
  selected: string | null;
  onSelect: (ch: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function ChannelList({ channels, selected, onSelect, query, onQueryChange, loading, error, onRefresh }: ChannelListProps) {
  const filtered = query.trim()
    ? channels.filter(ch => ch.channel.toLowerCase().includes(query.trim().toLowerCase()))
    : channels;

  return (
    <div className="flex flex-col h-full border-r" style={{ borderColor: 'var(--pd-border)', width: '220px', minWidth: '180px', flexShrink: 0 }}>
      <div className="px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>CHANNELS</div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="rounded p-1"
          style={{ color: 'var(--pd-muted)' }}
          title="Refresh channels"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="px-2 py-2 flex-shrink-0">
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Filter channels…"
          className="w-full rounded-md px-2 py-1.5 text-sm"
          style={{
            backgroundColor: 'var(--pd-bg)',
            color: 'var(--pd-text)',
            border: '1px solid var(--pd-border)',
          }}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error && (
          <div className="px-3 py-2 text-sm" style={{ color: 'var(--pd-accent)' }}>{error}</div>
        )}
        {filtered.map(ch => (
          <button
            key={ch.channel}
            onClick={() => onSelect(ch.channel)}
            className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 text-sm"
            style={{
              backgroundColor: selected === ch.channel ? 'var(--pd-surface)' : 'transparent',
              color: selected === ch.channel ? 'var(--pd-text)' : 'var(--pd-muted)',
              borderLeft: selected === ch.channel ? '2px solid var(--pd-accent)' : '2px solid transparent',
            }}
          >
            <span className="font-mono truncate min-w-0">{ch.channel}</span>
            <span className="shrink-0 text-[10px] font-semibold" style={{ color: 'var(--pd-dim)' }}>
              {ch.count}
            </span>
          </button>
        ))}
        {filtered.length === 0 && !error && !loading && (
          <div className="px-3 py-4 text-sm text-center" style={{ color: 'var(--pd-dim)' }}>
            {query ? 'No match' : 'No channels'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ChannelView ──────────────────────────────────────────────────────────────

interface ChannelViewProps {
  channel: string;
}

function ChannelView({ channel }: ChannelViewProps) {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishOk, setPublishOk] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const msgs = await getMessages(channel, 40);
      setMessages(msgs.reverse());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handlePublish = async () => {
    const text = draft.trim();
    if (!text) return;
    setPublishing(true);
    setPublishError(null);
    setPublishOk(false);
    try {
      await publishMessage(channel, text);
      setDraft('');
      setPublishOk(true);
      await load();
    } catch (err) {
      setPublishError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0">
      {/* Channel header */}
      <div className="px-4 py-2 flex items-center justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare size={13} style={{ color: 'var(--pd-accent)', flexShrink: 0 }} />
          <span className="font-mono text-sm truncate" style={{ color: 'var(--pd-text)' }}>{channel}</span>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {error && (
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
          >
            <AlertTriangle size={13} />
            {error}
          </div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-muted)' }}>No messages</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--pd-dim)' }}>Publish below to send the first message.</div>
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Publish bar */}
      <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        {publishError && (
          <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--pd-accent)' }}>{publishError}</div>
        )}
        {publishOk && (
          <div className="mb-2 text-sm font-semibold" style={{ color: 'var(--pd-success)' }}>Published.</div>
        )}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={e => { setDraft(e.target.value); setPublishOk(false); }}
            placeholder="JSON or plain text…"
            className="flex-1 min-w-0 rounded-md px-3 py-2 text-sm font-mono"
            style={{
              backgroundColor: 'var(--pd-bg)',
              color: 'var(--pd-text)',
              border: '1px solid var(--pd-border)',
            }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && draft.trim()) void handlePublish(); }}
          />
          <button
            disabled={publishing || !draft.trim()}
            onClick={() => void handlePublish()}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed"
            style={{
              backgroundColor: draft.trim() ? 'var(--pd-success-surface)' : 'var(--pd-bg)',
              color: draft.trim() ? 'var(--pd-success)' : 'var(--pd-muted)',
              border: `1px solid ${draft.trim() ? 'var(--pd-success-border)' : 'var(--pd-border)'}`,
            }}
          >
            <Send size={13} />
            {publishing ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className="mt-1 text-sm" style={{ color: 'var(--pd-dim)' }}>
          Valid JSON is sent as a JSON object; anything else as a plain string. Enter to send.
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function NoChannelSelected() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
      <ChevronRight size={28} style={{ color: 'var(--pd-dim)' }} />
      <div className="mt-3 text-sm font-semibold" style={{ color: 'var(--pd-muted)' }}>Select a channel</div>
      <div className="mt-1 text-sm max-w-[220px]" style={{ color: 'var(--pd-dim)' }}>
        Pick a channel on the left to browse messages and publish.
      </div>
    </div>
  );
}

// ─── TubeMessagePanel ─────────────────────────────────────────────────────────

export default function TubeMessagePanel() {
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const reloadChannels = useCallback(async () => {
    setChannelsLoading(true);
    setChannelsError(null);
    try {
      const chs = await listChannels(80);
      setChannels(chs);
    } catch (err) {
      setChannelsError((err as Error).message);
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  useEffect(() => { void reloadChannels(); }, [reloadChannels]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Panel header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>TUBE — CHANNEL BROWSER</div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--pd-text)' }}>
            {channels.length} channel{channels.length !== 1 ? 's' : ''} observed
          </div>
        </div>
      </div>

      {/* Two-pane layout */}
      <div className="flex flex-1 min-h-0">
        <ChannelList
          channels={channels}
          selected={selected}
          onSelect={setSelected}
          query={query}
          onQueryChange={setQuery}
          loading={channelsLoading}
          error={channelsError}
          onRefresh={reloadChannels}
        />
        {selected ? (
          <ChannelView key={selected} channel={selected} />
        ) : (
          <NoChannelSelected />
        )}
      </div>
    </div>
  );
}
