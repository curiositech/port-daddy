/**
 * ApprovalsPanel — the trust gate's pending human gates (ADR-0093 L2),
 * live over the approvals WebSocket, with approve/reject in place and a
 * contextual "Notify me" affordance for Web Push registration.
 *
 * Placement: the Operator tab, above the operator state — a held spawn is
 * the definition of "needs you". Renders nothing when the queue is empty
 * and push is already set up (no dead chrome).
 */

import { useState } from 'react';
import { ShieldAlert, Check, X, BellRing, BellOff, Wifi, WifiOff } from 'lucide-react';
import { useApprovalStream, type PendingApproval } from '../hooks/useApprovalStream';
import { usePushSubscription } from '../hooks/usePushSubscription';

function tierStyle(tier: string): { bg: string; border: string; color: string } {
  if (tier === 'ANONYMOUS_EXTERNAL') {
    return { bg: 'var(--pd-accent-surface)', border: 'var(--pd-accent-border)', color: 'var(--pd-accent)' };
  }
  return { bg: 'var(--pd-warning-surface)', border: 'var(--pd-warning-border)', color: 'var(--pd-warning)' };
}

function age(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function ProposalRow({ proposal, onDecide }: {
  proposal: PendingApproval;
  onDecide: (id: string, decision: 'approve' | 'reject') => void;
}) {
  const tier = tierStyle(proposal.tier);
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3"
      style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-border)' }}
    >
      <span style={{ color: tier.color }}><ShieldAlert size={18} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: 'var(--pd-text)' }}>
          {proposal.agent}
          <span className="font-normal" style={{ color: 'var(--pd-muted)' }}> ← {proposal.trigger}</span>
        </div>
        <div className="text-sm" style={{ color: 'var(--pd-muted)' }}>
          <span
            className="mr-2 inline-block rounded border px-1.5 py-0.5 text-sm font-semibold uppercase tracking-wide"
            style={{ backgroundColor: tier.bg, borderColor: tier.border, color: tier.color }}
          >
            {proposal.tier.replace('_', ' ').toLowerCase()}
          </span>
          {proposal.project} · tools: {proposal.safeTools.join(', ') || 'none'} · {age(proposal.timestamp)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onDecide(proposal.id, 'approve')}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold"
          style={{ backgroundColor: 'var(--pd-success-surface, var(--pd-surface))', borderColor: 'var(--pd-border)', color: 'var(--pd-success, var(--pd-text))' }}
        >
          <Check size={16} /> Approve
        </button>
        <button
          type="button"
          onClick={() => onDecide(proposal.id, 'reject')}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-semibold"
          style={{ backgroundColor: 'var(--pd-surface)', borderColor: 'var(--pd-accent-border)', color: 'var(--pd-accent)' }}
        >
          <X size={16} /> Reject
        </button>
      </div>
    </div>
  );
}

export default function ApprovalsPanel() {
  const stream = useApprovalStream(true);
  const push = usePushSubscription();
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const nothingToShow = stream.proposals.length === 0 && push.subscribed && !stream.lastError;
  if (nothingToShow) return null;

  return (
    <div className="mx-auto mt-4 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--pd-muted)' }}>
          <ShieldAlert size={16} />
          Spawn approvals
          <span title={stream.connected ? 'live' : 'reconnecting…'} style={{ color: stream.connected ? 'var(--pd-success, var(--pd-muted))' : 'var(--pd-warning)' }}>
            {stream.connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          </span>
        </h2>
        <button
          type="button"
          disabled={push.busy || !push.supported}
          onClick={() => {
            setPushMessage(null);
            void (push.subscribed ? push.unsubscribe() : push.subscribe()).catch((err: Error) => setPushMessage(err.message));
          }}
          title={push.reason ?? undefined}
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
          style={{
            backgroundColor: 'var(--pd-surface)',
            borderColor: 'var(--pd-border)',
            color: push.supported ? 'var(--pd-text)' : 'var(--pd-muted)',
            opacity: push.busy ? 0.6 : 1,
          }}
        >
          {push.subscribed ? <BellOff size={16} /> : <BellRing size={16} />}
          {push.subscribed ? 'Stop notifying this device' : 'Notify me on this device'}
        </button>
      </div>

      {!push.supported && push.reason && (
        <p className="mb-2 text-sm" style={{ color: 'var(--pd-muted)' }}>{push.reason}</p>
      )}
      {push.permission === 'denied' && (
        <p className="mb-2 text-sm" style={{ color: 'var(--pd-warning)' }}>
          Notifications are blocked for this site — re-enable them in browser settings, then retry.
        </p>
      )}
      {(pushMessage || stream.lastError) && (
        <p className="mb-2 text-sm" style={{ color: 'var(--pd-accent)' }}>{pushMessage ?? stream.lastError}</p>
      )}

      {stream.proposals.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--pd-muted)' }}>No spawns waiting for approval.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {stream.proposals.map((proposal) => (
            <ProposalRow key={proposal.id} proposal={proposal} onDecide={stream.decide} />
          ))}
        </div>
      )}
    </div>
  );
}
