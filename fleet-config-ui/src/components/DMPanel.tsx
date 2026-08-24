import { useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { fetchAgentInbox, fetchAgentInboxStats, fetchOperatorActors, publishMessage, sendAgentMessage } from '../api';
import type { InboxMessage, InboxStats, ResolvedChannelTarget } from '../types';
import { describeInboxAgentAvailability, resolveInboxAgentTargets, type InboxAgentTarget } from '../lib/inbox-targeting';

interface Props {
  channels: ResolvedChannelTarget[];
  project?: string | null;
  projectDir?: string | null;
  projectRunning?: boolean;
  configuredAgentCount?: number;
  layout?: 'compact' | 'full';
}

type DeliveryMode = 'channel' | 'agent';

function formatInboxContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return String(content ?? '');

  const candidate = content as Record<string, unknown>;
  if (candidate.type === 'visual-task' && typeof candidate.title === 'string') {
    const kind = typeof candidate.kind === 'string' ? candidate.kind : 'visual';
    return `[${kind}] ${candidate.title}`;
  }
  for (const key of ['summary', 'title', 'message', 'content', 'text', 'details']) {
    const value = candidate[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

/**
 * Operator messaging surface for direct inbox delivery and channel publication.
 * Direct inbox delivery targets durable actors through bounded external ingress.
 * The daemon owns sender provenance and delivery never wakes a runtime.
 */
export default function DMPanel({
  channels,
  project,
  projectDir,
  projectRunning = false,
  configuredAgentCount = 0,
  layout = 'compact',
}: Props) {
  const [mode, setMode] = useState<DeliveryMode>('agent');
  const [channel, setChannel] = useState(channels[0]?.logical || '');
  const [actorTargets, setActorTargets] = useState<InboxAgentTarget[]>([]);
  const [agent, setAgent] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [actorLoading, setActorLoading] = useState(false);
  const [agentInboxCredential, setAgentInboxCredential] = useState('');
  const [agentInboxLoading, setAgentInboxLoading] = useState(false);
  const [agentInboxStats, setAgentInboxStats] = useState<InboxStats>({ total: 0, unread: 0 });
  const [agentInboxMessages, setAgentInboxMessages] = useState<InboxMessage[]>([]);
  const [sent, setSent] = useState<Array<{ mode: DeliveryMode; target: string; message: string; ts: number }>>([]);

  const selectedTarget = actorTargets.find((target) => target.target === agent) ?? null;

  useEffect(() => {
    if (channels.length > 0 && !channels.some((entry) => entry.logical === channel)) {
      setChannel(channels[0]?.logical || '');
    }
  }, [channels, channel]);

  useEffect(() => {
    if (actorTargets.length > 0 && !actorTargets.some((target) => target.target === agent)) {
      setAgent(actorTargets[0]?.target ?? '');
    }
    if (actorTargets.length === 0 && agent) {
      setAgent('');
    }
  }, [actorTargets, agent]);

  useEffect(() => {
    let cancelled = false;

    async function loadActorTargets() {
      if (!projectDir && !project) {
        setActorTargets([]);
        return;
      }

      setActorLoading(true);
      try {
        const actors = await fetchOperatorActors({
          project: project ?? undefined,
          projectDir: projectDir ?? undefined,
          limit: 80,
        });
        if (!cancelled) {
          setActorTargets(resolveInboxAgentTargets(actors));
        }
      } catch (err) {
        if (!cancelled) {
          setDeliveryNotice((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setActorLoading(false);
        }
      }
    }

    loadActorTargets();
    return () => { cancelled = true; };
  }, [project, projectDir]);

  const inboxAvailabilityNote = describeInboxAgentAvailability({
    actorCount: actorTargets.length,
    configuredAgentCount,
    projectRunning,
  });

  useEffect(() => {
    setAgentInboxCredential('');
    setAgentInboxStats({ total: 0, unread: 0 });
    setAgentInboxMessages([]);
  }, [agent]);

  useEffect(() => {
    let cancelled = false;

    async function loadAgentInbox() {
      if (mode !== 'agent' || !agent || !agentInboxCredential.trim()) {
        setAgentInboxStats({ total: 0, unread: 0 });
        setAgentInboxMessages([]);
        return;
      }

      setAgentInboxLoading(true);
      try {
        const [stats, messages] = await Promise.all([
          fetchAgentInboxStats(agent, agentInboxCredential),
          fetchAgentInbox(agent, agentInboxCredential, { limit: 8 }),
        ]);
        if (!cancelled) {
          setAgentInboxStats(stats);
          setAgentInboxMessages(messages);
        }
      } catch (err) {
        if (!cancelled) {
          setDeliveryNotice((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setAgentInboxLoading(false);
        }
      }
    }

    loadAgentInbox();
    return () => { cancelled = true; };
  }, [agent, agentInboxCredential, mode]);

  const handleSend = async () => {
    const trimmed = message.trim();
    const selectedChannel = channels.find((entry) => entry.logical === channel) ?? null;
    const target = mode === 'agent' ? agent : selectedChannel?.logical ?? '';
    if (mode === 'agent' && actorTargets.length === 0) {
      setDeliveryNotice(inboxAvailabilityNote ?? 'No known project actor is available for direct inbox delivery.');
      return;
    }
    if (!trimmed || !target) return;

    setSending(true);
    setDeliveryNotice(null);
    try {
      if (mode === 'agent') {
        const result = await sendAgentMessage(agent, { content: trimmed });
        setDeliveryNotice(`Delivered to ${selectedTarget?.label ?? agent}${result.messageId ? ` as #${result.messageId}` : ''}.`);
        if (agentInboxCredential.trim()) {
          const [stats, messages] = await Promise.all([
            fetchAgentInboxStats(agent, agentInboxCredential),
            fetchAgentInbox(agent, agentInboxCredential, { limit: 8 }),
          ]);
          setAgentInboxStats(stats);
          setAgentInboxMessages(messages);
        }
      } else {
        await publishMessage(selectedChannel?.physical ?? channel, trimmed);
        setDeliveryNotice(`Published to ${selectedChannel?.logical ?? channel}.`);
      }
      setSent(s => [...s.slice(-10), { mode, target, message: trimmed, ts: Date.now() }]);
      setMessage('');
    } catch (err) {
      setDeliveryNotice((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const controls = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl p-1" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
          {(['agent', 'channel'] as DeliveryMode[]).map((value) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className="rounded-lg px-3 py-2 text-[11px] font-semibold tracking-wide"
              style={{
                backgroundColor: mode === value ? 'var(--pd-accent-surface)' : 'transparent',
                color: mode === value ? 'var(--pd-accent)' : 'var(--pd-muted)',
              }}
            >
              {value === 'agent' ? 'Inbox Agent' : 'Publish Channel'}
            </button>
          ))}
        </div>
        <span className="text-[11px]" style={{ color: 'var(--pd-dim)' }}>
          {mode === 'agent' ? 'Bounded direct delivery' : 'Broadcast only'}
        </span>
      </div>

      {deliveryNotice && (
        <div
          className="rounded-xl px-3 py-2 text-[12px]"
          style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
        >
          {deliveryNotice}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <label className="pd-label">{mode === 'agent' ? 'Target Agent' : 'Target Channel'}</label>
            <select
              value={mode === 'agent' ? agent : channel}
              onChange={e => mode === 'agent' ? setAgent(e.target.value) : setChannel(e.target.value)}
              className="pd-select font-mono"
              disabled={mode === 'agent' ? actorTargets.length === 0 : channels.length === 0}
            >
              {mode === 'agent'
                ? actorTargets.map((target) => (
                    <option key={target.target} value={target.target}>
                      {target.label} · {target.actorState}
                    </option>
                  ))
                : channels.map((entry) => <option key={entry.physical} value={entry.logical}>{entry.logical}</option>)}
            </select>
          </div>
          <div className="rounded-xl px-3 py-3" style={{ backgroundColor: 'var(--pd-bg)', border: '1px solid var(--pd-border)' }}>
            <div className="text-[10px] font-semibold tracking-[0.14em] mb-1" style={{ color: 'var(--pd-dim)' }}>
              ROUTING
            </div>
            <div className="text-[12px] leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
              {mode === 'agent'
                ? 'Use this for bounded external messages to one live canonical actor. The daemon attributes provenance and never wakes or controls the target runtime.'
                : 'Use this for broadcast traffic that multiple agents may hear through their trigger channels.'}
            </div>
            {mode === 'agent' && actorLoading && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--pd-dim)' }}>
                Loading actor targets…
              </div>
            )}
            {mode === 'agent' && selectedTarget && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--pd-dim)' }}>
                {selectedTarget.actorState.replace(/_/g, ' ')} · {selectedTarget.actorStateReason}
              </div>
            )}
            {mode === 'agent' && agent && (
              <div className="mt-3">
                <label className="pd-label">Actor credential for private readback</label>
                <input
                  type="password"
                  value={agentInboxCredential}
                  onChange={(event) => setAgentInboxCredential(event.target.value)}
                  autoComplete="off"
                  placeholder="Leave empty to send without reading"
                  className="pd-input font-mono"
                />
              </div>
            )}
            {mode === 'agent' && actorTargets.length === 0 && (
              <div className="mt-2 text-[11px]" style={{ color: 'var(--pd-accent)' }}>
                {inboxAvailabilityNote}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="pd-label">Message</label>
            {layout === 'full' ? (
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder={mode === 'agent' ? 'Ask the agent something concrete…' : 'Publish a useful channel update…'}
                className="pd-textarea"
              />
            ) : (
              <input
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
                placeholder={mode === 'agent' ? 'Ask the agent something...' : 'Publish to channel...'}
                className="pd-input"
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px]" style={{ color: 'var(--pd-dim)' }}>
              {project ? `Scoped to ${project}` : projectDir ? `Scoped to ${projectDir}` : 'No project scope attached'}
            </div>
            <button
              onClick={handleSend}
              disabled={sending || !message.trim() || (mode === 'agent' && actorTargets.length === 0)}
              className="pd-button pd-button-primary"
            >
              <Send size={14} />
              <span>{sending ? 'Sending…' : mode === 'agent' ? 'Send to agent' : 'Publish message'}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );

  if (layout === 'full') {
    return (
      <div className="h-full grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_360px]">
        <section className="pd-card p-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <div className="pd-kicker">Inbox</div>
              <h2 className="mt-2 text-2xl font-semibold" style={{ color: 'var(--pd-text)' }}>Direct operator messaging</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--pd-muted)' }}>
                Send a non-trivial instruction to a single agent or publish a useful message to a shared channel. Empty and ceremonial traffic is noise.
              </p>
            </div>
          </div>
          {controls}
        </section>

        <aside className="pd-card-muted p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <div className="pd-kicker">Recent</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
                {mode === 'agent' && agent ? `${agent} inbox` : 'Latest sent messages'}
              </div>
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                {mode === 'agent' && agent
                  ? agentInboxCredential.trim() ? `${agentInboxStats.unread}/${agentInboxStats.total} unread` : 'private'
                  : `${sent.length} total`}
            </div>
          </div>

          <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {mode === 'agent' ? (
              !agentInboxCredential.trim() ? (
                <div className="rounded-xl border px-3 py-4 text-sm" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                  Present the exact actor credential to inspect this private inbox. Sending does not grant read authority.
                </div>
              ) : agentInboxLoading ? (
                <div className="rounded-xl border px-3 py-4 text-sm" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                  Loading inbox…
                </div>
              ) : agentInboxMessages.length === 0 ? (
                <div className="rounded-xl border px-3 py-4 text-sm" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                  No messages stored for {agent || 'this agent'} yet.
                </div>
              ) : (
                agentInboxMessages.map((entry) => (
                  <div key={entry.id} className="rounded-xl border px-3 py-3" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[10px] font-mono" style={{ color: entry.read ? 'var(--pd-dim)' : 'var(--pd-accent)' }}>
                        {entry.from ? `<${entry.from}>` : 'system'}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                        {new Date(entry.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                      {formatInboxContent(entry.content)}
                    </div>
                  </div>
                ))
              )
            ) : sent.length === 0 ? (
              <div className="rounded-xl border px-3 py-4 text-sm" style={{ color: 'var(--pd-muted)', borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                Nothing sent yet from this session.
              </div>
            ) : (
              sent.slice().reverse().map((entry, index) => (
                <div key={`${entry.ts}-${index}`} className="rounded-xl border px-3 py-3" style={{ borderColor: 'var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-mono" style={{ color: 'var(--pd-accent)' }}>
                      {entry.mode === 'agent' ? `@${entry.target}` : `#${entry.target}`}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--pd-dim)' }}>
                      {new Date(entry.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--pd-text)' }}>
                    {entry.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="px-3 py-2" style={{ borderTop: '1px solid var(--pd-border)' }}>
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
      {controls}
    </div>
  );
}
