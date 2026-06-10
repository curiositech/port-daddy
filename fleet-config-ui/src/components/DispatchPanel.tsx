/**
 * DispatchPanel — operator control surface for the dispatch queue.
 *
 * Routes used:
 *   GET    /dispatches          — list dispatches
 *   POST   /dispatches          — propose a new dispatch
 *   POST   /dispatches/:id/accept
 *   POST   /dispatches/:id/reject
 *   POST   /dispatches/:id/cancel
 *
 * If the daemon returns 404 (dispatch queue not wired in this binary), we
 * render a clear "not available on this daemon" state rather than a dead button.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Send, Terminal, XCircle } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type DispatchState =
  | 'proposed'
  | 'claimed'
  | 'in_progress'
  | 'produced'
  | 'review_pending'
  | 'accepted'
  | 'rejected'
  | 'settled'
  | 'failed'
  | 'salvage';

interface Dispatch {
  id: string;
  slug: string;
  goal: string;
  tags: string[];
  state: DispatchState;
  requestedBy: string;
  targetActorId: string | null;
  workerActorId: string | null;
  reviewerActorId: string | null;
  baseBranch: string;
  backend: string | null;
  budgetUsd: number | null;
  branch: string | null;
  resultArtifact: string | null;
  costUsd: number | null;
  errorMessage: string | null;
  mergePolicy: string;
  rejectReason: string | null;
  createdAt: number;
  claimedAt: number | null;
  startedAt: number | null;
  producedAt: number | null;
  reviewedAt: number | null;
  settledAt: number | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function daemonBase(): string {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage?.getItem('pd.fleet-ui.daemon-url');
    if (stored) return stored;
  }
  return 'http://127.0.0.1:9876';
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${daemonBase()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(
      typeof body.error === 'string' ? body.error : `${res.status} ${res.statusText}`
    ) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

async function fetchDispatches(filter: 'all' | 'open' | 'awaiting_review' | 'terminal' = 'all'): Promise<Dispatch[]> {
  const qs = filter !== 'all' ? `?state=${filter}` : '';
  const data = await apiFetch<{ dispatches: Dispatch[] }>(`/dispatches${qs}`);
  return data.dispatches ?? [];
}

async function proposeDispatch(goal: string): Promise<Dispatch> {
  const data = await apiFetch<{ dispatch: Dispatch }>('/dispatches', {
    method: 'POST',
    body: JSON.stringify({ goal, requestedBy: 'fleet-ui', mergePolicy: 'review' }),
  });
  return data.dispatch;
}

async function acceptDispatch(id: string): Promise<Dispatch> {
  const data = await apiFetch<{ dispatch: Dispatch }>(`/dispatches/${encodeURIComponent(id)}/accept`, {
    method: 'POST',
  });
  return data.dispatch;
}

async function rejectDispatch(id: string, reason: string): Promise<Dispatch> {
  const data = await apiFetch<{ dispatch: Dispatch }>(`/dispatches/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
  return data.dispatch;
}

async function cancelDispatch(id: string): Promise<Dispatch> {
  const data = await apiFetch<{ dispatch: Dispatch }>(`/dispatches/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'cancelled from fleet-ui' }),
  });
  return data.dispatch;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type StateTone = 'default' | 'active' | 'review' | 'success' | 'error';

function stateTone(state: DispatchState): StateTone {
  if (['in_progress', 'claimed'].includes(state)) return 'active';
  if (['review_pending', 'produced'].includes(state)) return 'review';
  if (['accepted', 'settled'].includes(state)) return 'success';
  if (['rejected', 'failed', 'salvage'].includes(state)) return 'error';
  return 'default';
}

function tonePalette(tone: StateTone): [string, string, string] {
  switch (tone) {
    case 'active': return ['var(--pd-warning-surface)', 'var(--pd-warning)', 'var(--pd-warning-border)'];
    case 'review': return ['var(--pd-accent-surface)', 'var(--pd-accent)', 'var(--pd-accent-border)'];
    case 'success': return ['var(--pd-success-surface)', 'var(--pd-success)', 'var(--pd-success-border)'];
    case 'error': return ['var(--pd-accent-surface)', 'var(--pd-accent)', 'var(--pd-accent-border)'];
    default: return ['var(--pd-bg)', 'var(--pd-muted)', 'var(--pd-border)'];
  }
}

function StateBadge({ state }: { state: DispatchState }) {
  const [bg, fg, border] = tonePalette(stateTone(state));
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg, border: `1px solid ${border}` }}
    >
      {state.replace(/_/g, ' ')}
    </span>
  );
}

function RelativeTime({ ts }: { ts: number }) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return <>{diff}s ago</>;
  if (diff < 3600) return <>{Math.floor(diff / 60)}m ago</>;
  if (diff < 86400) return <>{Math.floor(diff / 3600)}h ago</>;
  return <>{Math.floor(diff / 86400)}d ago</>;
}

// ─── DispatchRow ──────────────────────────────────────────────────────────────

interface DispatchRowProps {
  dispatch: Dispatch;
  busy: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
}

function DispatchRow({ dispatch: d, busy, onAccept, onReject, onCancel }: DispatchRowProps) {
  const [rejectDraft, setRejectDraft] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const tone = stateTone(d.state);
  const isTerminal = ['settled', 'failed', 'salvage', 'accepted', 'rejected'].includes(d.state);
  const canReview = d.state === 'review_pending';
  const canCancel = !isTerminal && !['accepted'].includes(d.state);
  const rowBusy = busy === d.id;

  return (
    <div
      className="rounded-md border p-3"
      style={{ backgroundColor: 'var(--pd-bg)', borderColor: tone === 'review' ? 'var(--pd-accent-border)' : 'var(--pd-border)' }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug" style={{ color: 'var(--pd-text)' }}>
            {d.goal}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--pd-dim)' }}>
            <span className="font-mono">{d.slug}</span>
            <span>·</span>
            <RelativeTime ts={d.createdAt} />
            {d.workerActorId && (
              <>
                <span>·</span>
                <span>worker: <span className="font-mono" style={{ color: 'var(--pd-muted)' }}>{d.workerActorId}</span></span>
              </>
            )}
            {d.branch && (
              <>
                <span>·</span>
                <span className="font-mono" style={{ color: 'var(--pd-muted)' }}>{d.branch}</span>
              </>
            )}
            {d.resultArtifact && (
              <>
                <span>·</span>
                <span className="font-mono truncate max-w-[180px]" style={{ color: 'var(--pd-accent)' }}>{d.resultArtifact}</span>
              </>
            )}
          </div>
          {d.errorMessage && (
            <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--pd-accent)' }}>
              {d.errorMessage}
            </div>
          )}
          {d.rejectReason && (
            <div className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>
              Rejected: {d.rejectReason}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 flex-wrap">
          <StateBadge state={d.state} />
        </div>
      </div>

      {(canReview || (canCancel && !isTerminal)) && (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {canReview && (
            <>
              <button
                disabled={rowBusy}
                onClick={() => onAccept(d.id)}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
                style={{
                  backgroundColor: 'var(--pd-success-surface)',
                  color: 'var(--pd-success)',
                  border: '1px solid var(--pd-success-border)',
                  opacity: rowBusy ? 0.6 : 1,
                }}
              >
                <CheckCircle2 size={12} />
                {rowBusy ? 'Working' : 'Accept'}
              </button>
              {!rejecting ? (
                <button
                  disabled={rowBusy}
                  onClick={() => setRejecting(true)}
                  className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: 'var(--pd-accent-surface)',
                    color: 'var(--pd-accent)',
                    border: '1px solid var(--pd-accent-border)',
                    opacity: rowBusy ? 0.6 : 1,
                  }}
                >
                  <XCircle size={12} />
                  Reject
                </button>
              ) : (
                <div className="flex items-center gap-2 w-full mt-1">
                  <input
                    value={rejectDraft}
                    onChange={e => setRejectDraft(e.target.value)}
                    placeholder="Reason (required)"
                    className="flex-1 min-w-0 rounded-md px-2 py-1.5 text-sm"
                    style={{
                      backgroundColor: 'var(--pd-surface)',
                      color: 'var(--pd-text)',
                      border: '1px solid var(--pd-border)',
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setRejecting(false); setRejectDraft(''); }
                      if (e.key === 'Enter' && rejectDraft.trim().length >= 3) onReject(d.id + '::' + rejectDraft.trim());
                    }}
                  />
                  <button
                    disabled={rejectDraft.trim().length < 3 || rowBusy}
                    onClick={() => onReject(d.id + '::' + rejectDraft.trim())}
                    className="rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: 'var(--pd-accent-surface)',
                      color: 'var(--pd-accent)',
                      border: '1px solid var(--pd-accent-border)',
                    }}
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => { setRejecting(false); setRejectDraft(''); }}
                    className="rounded-md px-2 py-1.5 text-sm"
                    style={{ color: 'var(--pd-muted)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-bg)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
          {canCancel && (
            <button
              disabled={rowBusy}
              onClick={() => onCancel(d.id)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'var(--pd-bg)',
                color: 'var(--pd-muted)',
                border: '1px solid var(--pd-border)',
                opacity: rowBusy ? 0.6 : 1,
              }}
            >
              Cancel dispatch
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DispatchPanel ────────────────────────────────────────────────────────────

type FilterChoice = 'all' | 'open' | 'awaiting_review' | 'terminal';

const FILTER_OPTIONS: Array<{ id: FilterChoice; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'awaiting_review', label: 'Needs review' },
  { id: 'terminal', label: 'Terminal' },
];

export default function DispatchPanel() {
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterChoice>('all');
  const [goalDraft, setGoalDraft] = useState('');
  const [proposeBusy, setProposeBusy] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async (f: FilterChoice = filter) => {
    setLoading(true);
    setError(null);
    setUnavailable(false);
    try {
      const list = await fetchDispatches(f);
      setDispatches(list);
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 404 || e.message.includes('404') || e.message.includes('not found')) {
        setUnavailable(true);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void reload(); }, [reload]);

  const handleFilterChange = (f: FilterChoice) => {
    setFilter(f);
    void reload(f);
  };

  const handlePropose = async () => {
    const goal = goalDraft.trim();
    if (!goal) return;
    setProposeBusy(true);
    setProposeError(null);
    try {
      const d = await proposeDispatch(goal);
      setDispatches(prev => [d, ...prev]);
      setGoalDraft('');
    } catch (err) {
      setProposeError((err as Error).message);
    } finally {
      setProposeBusy(false);
    }
  };

  const handleAccept = async (id: string) => {
    setActionBusy(id);
    setActionError(null);
    try {
      const updated = await acceptDispatch(id);
      setDispatches(prev => prev.map(d => d.id === id ? updated : d));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleReject = async (token: string) => {
    const sep = token.indexOf('::');
    const id = sep > 0 ? token.slice(0, sep) : token;
    const reason = sep > 0 ? token.slice(sep + 2) : 'rejected from fleet-ui';
    setActionBusy(id);
    setActionError(null);
    try {
      const updated = await rejectDispatch(id, reason);
      setDispatches(prev => prev.map(d => d.id === id ? updated : d));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionBusy(id);
    setActionError(null);
    try {
      const updated = await cancelDispatch(id);
      setDispatches(prev => prev.map(d => d.id === id ? updated : d));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setActionBusy(null);
    }
  };

  // ── Not available on this daemon ────────────────────────────────────────────
  if (unavailable) {
    return (
      <div className="p-4">
        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: 'var(--pd-dim)' }}>DISPATCH QUEUE</div>
        <div
          className="rounded-lg border p-4 flex items-start gap-3"
          style={{ backgroundColor: 'var(--pd-warning-surface)', borderColor: 'var(--pd-warning-border)' }}
        >
          <Terminal size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--pd-warning)' }} />
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
              Dispatch queue not available on this daemon
            </div>
            <div className="mt-1 text-sm" style={{ color: 'var(--pd-muted)' }}>
              The <span className="font-mono">/dispatches</span> routes are not registered in the currently connected daemon.
              This usually means the daemon binary predates the dispatch queue feature.
            </div>
            <div
              className="mt-2 rounded-md px-3 py-2 text-sm font-mono"
              style={{ backgroundColor: 'var(--pd-code)', color: 'var(--pd-muted)', border: '1px solid var(--pd-border)' }}
            >
              Use the CLI instead: <span style={{ color: 'var(--pd-accent)' }}>pd dispatch propose "your goal"</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        <div>
          <div className="text-[10px] font-semibold tracking-wider" style={{ color: 'var(--pd-dim)' }}>DISPATCH QUEUE</div>
          <div className="text-sm font-semibold mt-0.5" style={{ color: 'var(--pd-text)' }}>
            {loading ? 'Loading…' : `${dispatches.length} dispatch${dispatches.length === 1 ? '' : 'es'}`}
          </div>
        </div>
        <button
          onClick={() => void reload()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold"
          style={{ color: 'var(--pd-text)', border: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Propose form */}
      <div className="px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)', backgroundColor: 'var(--pd-surface)' }}>
        <div className="text-[10px] font-semibold tracking-wider mb-2" style={{ color: 'var(--pd-dim)' }}>PROPOSE A GOAL</div>
        <div className="flex gap-2">
          <input
            value={goalDraft}
            onChange={e => setGoalDraft(e.target.value)}
            placeholder="Describe the work goal (sentence form)…"
            className="flex-1 min-w-0 rounded-md px-3 py-2 text-sm"
            style={{
              backgroundColor: 'var(--pd-bg)',
              color: 'var(--pd-text)',
              border: '1px solid var(--pd-border)',
            }}
            onKeyDown={e => { if (e.key === 'Enter' && goalDraft.trim()) void handlePropose(); }}
          />
          <button
            disabled={proposeBusy || !goalDraft.trim()}
            onClick={() => void handlePropose()}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed"
            style={{
              backgroundColor: goalDraft.trim() ? 'var(--pd-success-surface)' : 'var(--pd-bg)',
              color: goalDraft.trim() ? 'var(--pd-success)' : 'var(--pd-muted)',
              border: `1px solid ${goalDraft.trim() ? 'var(--pd-success-border)' : 'var(--pd-border)'}`,
            }}
          >
            <Send size={13} />
            {proposeBusy ? 'Proposing…' : 'Propose'}
          </button>
        </div>
        {proposeError && (
          <div className="mt-2 text-sm font-semibold" style={{ color: 'var(--pd-accent)' }}>{proposeError}</div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex gap-0.5 px-4 pt-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--pd-border)' }}>
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => handleFilterChange(opt.id)}
            className="px-3 py-1.5 text-xs font-semibold tracking-wide rounded-t whitespace-nowrap"
            style={{
              backgroundColor: filter === opt.id ? 'var(--pd-surface)' : 'transparent',
              color: filter === opt.id ? 'var(--pd-text)' : 'var(--pd-muted)',
              borderBottom: filter === opt.id ? '2px solid var(--pd-accent)' : '2px solid transparent',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {actionError && (
          <div
            className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
          >
            <AlertTriangle size={13} />
            {actionError}
          </div>
        )}
        {error && (
          <div
            className="mb-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: 'var(--pd-accent-surface)', color: 'var(--pd-accent)', border: '1px solid var(--pd-accent-border)' }}
          >
            <AlertTriangle size={13} />
            {error}
          </div>
        )}
        {!loading && dispatches.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-sm font-semibold" style={{ color: 'var(--pd-muted)' }}>No dispatches</div>
            <div className="mt-1 text-sm" style={{ color: 'var(--pd-dim)' }}>
              Propose a goal above — the dispatch queue will route it to an agent.
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2">
          {dispatches.map(d => (
            <DispatchRow
              key={d.id}
              dispatch={d}
              busy={actionBusy}
              onAccept={handleAccept}
              onReject={handleReject}
              onCancel={handleCancel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
