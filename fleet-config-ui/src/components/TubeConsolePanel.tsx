import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareReply, Pause, Play, RefreshCw, Send, TerminalSquare } from 'lucide-react';
import { fetchChannelMessages, publishMessage, resolveChannel } from '../api';
import type { ChannelMessage, DeclaredChannel, ResolvedChannelTarget } from '../types';

const TUBE_ENVELOPE_KIND = 'tube.msg';

interface TubeEnvelope {
  v: 1;
  kind: typeof TUBE_ENVELOPE_KIND;
  body: string;
  inReplyTo?: number;
}

interface TubeRow {
  id: number;
  sender: string | null;
  createdAt: number;
  body: string;
  inReplyTo?: number;
  envelope: boolean;
  raw: unknown;
}

interface Props {
  channels: ResolvedChannelTarget[];
  selectedChannel: string | null;
  projectDir?: string;
  onChannelFocus?: (channel: string | null) => void;
}

function decodeTubeMessage(message: ChannelMessage): TubeRow {
  const payload = message.payload;
  let body = '';
  let inReplyTo: number | undefined;
  let envelope = false;

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (record.kind === TUBE_ENVELOPE_KIND && typeof record.body === 'string') {
      envelope = true;
      body = record.body;
      if (typeof record.inReplyTo === 'number' && Number.isFinite(record.inReplyTo)) {
        inReplyTo = record.inReplyTo;
      }
    } else {
      body = JSON.stringify(payload, null, 2);
    }
  } else if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.kind === TUBE_ENVELOPE_KIND && typeof record.body === 'string') {
          envelope = true;
          body = record.body;
          if (typeof record.inReplyTo === 'number' && Number.isFinite(record.inReplyTo)) {
            inReplyTo = record.inReplyTo;
          }
        } else {
          body = payload;
        }
      } else {
        body = payload;
      }
    } catch {
      body = payload;
    }
  } else {
    body = String(payload ?? '');
  }

  return {
    id: message.id,
    sender: message.sender,
    createdAt: message.createdAt,
    body,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    envelope,
    raw: payload,
  };
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function buildEnvelope(body: string, inReplyTo?: number): TubeEnvelope {
  return {
    v: 1,
    kind: TUBE_ENVELOPE_KIND,
    body,
    ...(typeof inReplyTo === 'number' && Number.isFinite(inReplyTo) ? { inReplyTo } : {}),
  };
}

function channelTargetFor(channels: ResolvedChannelTarget[], logical: string): ResolvedChannelTarget | null {
  return channels.find((channel) => channel.logical === logical || channel.physical === logical) ?? null;
}

export default function TubeConsolePanel({ channels, selectedChannel, projectDir, onChannelFocus }: Props) {
  const defaultChannel = selectedChannel ?? channels[0]?.logical ?? 'debug:agent-thoughts';
  const [channelInput, setChannelInput] = useState(defaultChannel);
  const [resolvedChannel, setResolvedChannel] = useState<DeclaredChannel | null>(null);
  const [messages, setMessages] = useState<TubeRow[]>([]);
  const [body, setBody] = useState('');
  const [sender, setSender] = useState('fleet-ui:tube');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [limit, setLimit] = useState(50);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPostId, setLastPostId] = useState<number | null>(null);

  useEffect(() => {
    if (selectedChannel) setChannelInput(selectedChannel);
  }, [selectedChannel]);

  const target = useMemo(() => {
    const declared = channelTargetFor(channels, channelInput.trim());
    if (declared) return declared;
    if (resolvedChannel) return { logical: resolvedChannel.logicalName, physical: resolvedChannel.physicalName };
    const raw = channelInput.trim();
    return { logical: raw, physical: raw };
  }, [channelInput, channels, resolvedChannel]);

  const loadMessages = useCallback(async () => {
    if (!target.physical) {
      setMessages([]);
      return;
    }
    try {
      const rows = await fetchChannelMessages(target.physical, limit);
      setMessages(rows.map(decodeTubeMessage));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [limit, target.physical]);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const trimmed = channelInput.trim();
      if (!trimmed) {
        setResolvedChannel(null);
        return;
      }
      const direct = channelTargetFor(channels, trimmed);
      if (direct) {
        setResolvedChannel(null);
        return;
      }
      const resolved = await resolveChannel(trimmed, projectDir);
      if (!cancelled) setResolvedChannel(resolved);
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [channelInput, channels, projectDir]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => void loadMessages(), 2500);
    return () => window.clearInterval(timer);
  }, [live, loadMessages]);

  const sendMessage = async () => {
    const trimmed = body.trim();
    if (!trimmed || !target.physical) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publishMessage(target.physical, buildEnvelope(trimmed, replyTo ?? undefined), sender.trim() || 'fleet-ui:tube');
      if (typeof result.id === 'number') setLastPostId(result.id);
      setBody('');
      setReplyTo(null);
      onChannelFocus?.(target.logical);
      await loadMessages();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const latestId = messages.at(-1)?.id ?? null;
  const threadCount = messages.filter((message) => typeof message.inReplyTo === 'number').length;
  const foreignCount = messages.filter((message) => !message.envelope).length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid gap-3 border-b p-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1fr)]" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>
            <TerminalSquare size={13} />
            <span>TUBE CONSOLE</span>
          </div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            Conversational pipe over a daemon channel
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="pd-chip" style={{ backgroundColor: 'var(--pd-bg)', color: 'var(--pd-muted)', borderColor: 'var(--pd-border)' }}>
              latest id {latestId ?? 'none'}
            </span>
            <span className="pd-chip" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', borderColor: 'var(--pd-success-border)' }}>
              {threadCount} replies
            </span>
            <span className="pd-chip" style={{ backgroundColor: foreignCount ? 'var(--pd-warning-surface)' : 'var(--pd-bg)', color: foreignCount ? 'var(--pd-warning)' : 'var(--pd-muted)', borderColor: foreignCount ? 'var(--pd-warning-border)' : 'var(--pd-border)' }}>
              {foreignCount} foreign
            </span>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="min-w-0">
            <span className="pd-label">Channel</span>
            <input
              className="pd-input font-mono"
              list="tube-console-channels"
              value={channelInput}
              onChange={(event) => setChannelInput(event.target.value)}
              onBlur={() => onChannelFocus?.(target.logical)}
            />
            <datalist id="tube-console-channels">
              {channels.map((channel) => (
                <option key={channel.physical} value={channel.logical} />
              ))}
            </datalist>
          </label>
          <label className="w-24">
            <span className="pd-label">Limit</span>
            <input
              className="pd-input font-mono"
              type="number"
              min="1"
              max="250"
              value={limit}
              onChange={(event) => setLimit(Math.max(1, Math.min(250, Number(event.target.value) || 50)))}
            />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" className="pd-button pd-button-secondary" onClick={() => void loadMessages()}>
              <RefreshCw size={14} />
              Poll
            </button>
            <button type="button" className="pd-button pd-button-secondary" onClick={() => setLive((value) => !value)}>
              {live ? <Pause size={14} /> : <Play size={14} />}
              {live ? 'Live' : 'Paused'}
            </button>
          </div>
          <div className="md:col-span-3 rounded-lg border px-3 py-2 text-[11px] font-mono" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}>
            logical {target.logical || 'n/a'} · physical {target.physical || 'n/a'}
          </div>
        </div>
      </div>

      <div className="grid flex-1 min-h-0 gap-4 overflow-hidden p-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <section className="pd-card min-h-0 overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--pd-border)' }}>
            <div>
              <div className="pd-kicker">Stream</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>{messages.length} decoded rows</div>
            </div>
            {lastPostId ? (
              <span className="pd-chip" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', borderColor: 'var(--pd-success-border)' }}>
                posted {lastPostId}
              </span>
            ) : null}
          </div>
          <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-3 pb-20">
            {messages.length === 0 ? (
              <div className="pd-card-inset p-6 text-center text-sm" style={{ color: 'var(--pd-muted)' }}>
                No messages on this channel yet.
              </div>
            ) : messages.map((message) => (
              <article key={message.id} className="rounded-xl border p-3" style={{ borderColor: replyTo === message.id ? 'var(--pd-accent-border)' : 'var(--pd-border)', backgroundColor: message.envelope ? 'var(--pd-bg)' : 'var(--pd-warning-surface)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
                    <span style={{ color: 'var(--pd-accent)' }}>#{message.id}</span>
                    <span style={{ color: 'var(--pd-muted)' }}>{message.sender ?? 'system'}</span>
                    <span style={{ color: 'var(--pd-dim)' }}>{formatTime(message.createdAt)}</span>
                    {message.inReplyTo ? (
                      <span className="pd-chip" style={{ backgroundColor: 'var(--pd-success-surface)', color: 'var(--pd-success)', borderColor: 'var(--pd-success-border)' }}>
                        reply to {message.inReplyTo}
                      </span>
                    ) : null}
                    {!message.envelope ? (
                      <span className="pd-chip" style={{ backgroundColor: 'var(--pd-warning-surface)', color: 'var(--pd-warning)', borderColor: 'var(--pd-warning-border)' }}>
                        foreign
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="pd-button pd-button-secondary min-h-0 px-2 py-1 text-[11px]"
                    onClick={() => setReplyTo((current) => current === message.id ? null : message.id)}
                  >
                    <MessageSquareReply size={13} />
                    Reply
                  </button>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--pd-text)', fontFamily: 'var(--pd-font-mono)' }}>{message.body}</pre>
              </article>
            ))}
          </div>
        </section>

        <aside className="pd-card min-h-0 overflow-y-auto p-4">
          <div className="pd-kicker">Compose</div>
          <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
            {replyTo ? `Replying to #${replyTo}` : 'Top-level message'}
          </div>
          <label className="mt-4 block">
            <span className="pd-label">Sender</span>
            <input className="pd-input font-mono" value={sender} onChange={(event) => setSender(event.target.value)} />
          </label>
          <label className="mt-3 block">
            <span className="pd-label">Body</span>
            <textarea className="pd-textarea font-mono" value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          {replyTo ? (
            <button type="button" className="pd-button pd-button-secondary mt-3 w-full" onClick={() => setReplyTo(null)}>
              Clear reply target
            </button>
          ) : null}
          <button
            type="button"
            className="pd-button pd-button-primary mt-3 w-full"
            disabled={busy || !body.trim() || !target.physical}
            onClick={() => void sendMessage()}
          >
            <Send size={14} />
            {replyTo ? 'Send reply' : 'Send message'}
          </button>
          {error ? (
            <div className="pd-card-inset mt-3 p-3 text-xs" style={{ color: 'var(--pd-accent)' }}>{error}</div>
          ) : null}
          <div className="pd-card-inset mt-3 p-3 text-[11px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
            Envelope: <span className="font-mono">{'{"v":1,"kind":"tube.msg","body":"..."}'}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}
