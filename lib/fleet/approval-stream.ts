/**
 * Fleet approval stream — the live, bidirectional surface over the trust
 * gate's L2 approval queue (ADR-0093). Server→client: pending spawn
 * proposals as they arrive. Client→server: the operator's approve/reject
 * decision, which is what actually releases (or kills) the held spawn.
 *
 * This is the piece that was manual after the trust-gate wiring landed:
 * proposals landed as durable `fleet:approval` tuples and approving meant
 * hand-crafting a POST /fleet/agent/run. Now a dashboard holds one
 * WebSocket and the human-gate loop closes in two clicks.
 *
 * Protocol (websocket-streaming skill idiom — typed unions, delta-only,
 * snapshot on connect for resync after reconnects):
 *
 *   server → client
 *     { type: 'snapshot',            proposals: PendingApproval[] }
 *     { type: 'human_gate_waiting',  proposal: PendingApproval }
 *     { type: 'human_gate_resolved', id, decision, resolvedBy, detail? }
 *     { type: 'error',               id?, message }
 *
 *   client → server
 *     { type: 'human_decision', id, decision: 'approve' | 'reject', feedback? }
 *
 * Division of labor: THIS module owns the in-memory pending set and the
 * broadcast fan-out; the DAEMON injects what approve/reject actually DO
 * (hail the agent with the stored context; drop the durable tuple) via
 * configure(). Durability note: tuples remain the durable record (7d TTL);
 * the in-memory set rehydrates from whatever the daemon replays into
 * enqueue() at boot. Distinct from lib/fleet-hitl-proposals (PR #648):
 * that queue gates cloud-ship PRODUCT proposals; this gates trust-tier
 * SPAWNS. If they converge, this stream is the transport either can
 * broadcast into.
 */

import { createHash } from 'node:crypto';
import type { FleetApprovalProposal, FleetRunContext } from '../fleet-engine.js';

export interface PendingApproval extends FleetApprovalProposal {
  id: string;
}

export type ApprovalServerEvent =
  | { type: 'snapshot'; proposals: PendingApproval[] }
  | { type: 'human_gate_waiting'; proposal: PendingApproval }
  | {
      type: 'human_gate_resolved';
      id: string;
      decision: 'approve' | 'reject' | 'expired';
      resolvedBy: string;
      detail?: string;
    }
  | { type: 'error'; id?: string; message: string };

export type ApprovalClientEvent = {
  type: 'human_decision';
  id: string;
  decision: 'approve' | 'reject';
  feedback?: string;
};

export interface ApprovalActions {
  /** Release the held spawn: hail the agent with the stored context. */
  hail: (proposal: PendingApproval) => Promise<{ success: boolean; error?: string }>;
  /**
   * Atomically CLAIM the durable fleet:approval record (tuple take) before
   * acting on a decision. Returns false when a durable record exists-space
   * but this proposal's record is gone — i.e. another surface already
   * claimed it, or it expired — in which case the decision is refused.
   * Implementations without a durable store return true (nothing to claim).
   */
  claimDurable: (proposal: PendingApproval) => boolean;
  /**
   * Compensating transaction: restore the durable record after a claim
   * whose follow-up action (the hail) failed, so the proposal survives a
   * retry — and a crash — instead of silently evaporating.
   */
  restoreDurable: (proposal: PendingApproval) => void;
}

type Listener = (event: ApprovalServerEvent) => void;

/**
 * Hard cap on undecided proposals (griefing defense — cryptoeconomic
 * Attack Class 2). Inbound triggers are near-free to the sender (mail an
 * address, POST an unsecured webhook channel) and every external one lands
 * here as an approval. Content-fingerprint dedup + TTL expiry collapse
 * *identical* floods, but a sender who VARIES the body each time defeats
 * dedup and would grow this Map without bound — memory exhaustion plus
 * operator-attention burial. When full we refuse new enqueues (fail-closed:
 * the trigger can fire again once the operator drains the queue; dropping a
 * flood beats OOMing the daemon). Matches PR #648's MAX_PENDING_FLEET_PROPOSALS.
 */
export const MAX_PENDING_APPROVALS = 200;

export class FleetApprovalStream {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<Listener>();
  private actions: ApprovalActions | null = null;
  private capWarned = false;

  /** The daemon injects what approve/reject DO. Without it, decisions are
   *  refused (fail-closed) — the stream never invents its own spawn path. */
  configure(actions: ApprovalActions): void {
    this.actions = actions;
  }

  /**
   * New proposal from the trust gate (or a boot-time tuple replay).
   * Returns false when deduped — callers writing a durable record MUST
   * skip the write then, or the orphan record resurrects as a ghost gate
   * on the next restart after its twin was decided.
   */
  enqueue(proposal: PendingApproval): boolean {
    if (this.pending.has(proposal.id)) return false; // replay-safe by id
    // Content-level idempotency: a retried delivery that slipped past the
    // trigger-layer dedup (daemon restart cleared it, different transport)
    // arrives with a FRESH uuid but identical substance. One inbound event
    // must never stack two human gates.
    const fingerprint = proposalFingerprint(proposal);
    for (const existing of this.pending.values()) {
      if (proposalFingerprint(existing) === fingerprint) return false;
    }
    // Griefing cap (Attack Class 2): refuse past the ceiling rather than let
    // a distinct-content flood exhaust memory / bury the operator. Warn once
    // per saturation episode so it's visible, not silent.
    if (this.pending.size >= MAX_PENDING_APPROVALS) {
      if (!this.capWarned) {
        this.capWarned = true;
        this.broadcast({
          type: 'error',
          message: `approval queue full (${MAX_PENDING_APPROVALS}); refusing new spawn gates until drained — possible inbound flood`,
        });
      }
      return false;
    }
    this.capWarned = false;
    this.pending.set(proposal.id, proposal);
    this.broadcast({ type: 'human_gate_waiting', proposal });
    return true;
  }

  list(): PendingApproval[] {
    return [...this.pending.values()].sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Apply an operator decision. Returns the event that was broadcast (or
   *  the error event when refused) so HTTP callers can relay it. */
  async decide(event: ApprovalClientEvent, resolvedBy: string): Promise<ApprovalServerEvent> {
    const proposal = this.pending.get(event.id);
    if (!proposal) {
      return { type: 'error', id: event.id, message: 'unknown or already-resolved proposal' };
    }
    if (!this.actions) {
      return {
        type: 'error',
        id: event.id,
        message: 'approval actions not configured (daemon still booting?) — decision refused, proposal kept',
      };
    }

    // Mini-saga ordering (microservices-patterns): CLAIM the durable record
    // FIRST (atomic take), then act. A crash after the claim loses the
    // decision (fail-closed: the trigger can fire again) instead of leaving
    // a record that rehydrates after restart and gets approved a second
    // time (double spawn). A concurrent decision from another surface loses
    // the claim race and is refused here.
    let claimed: boolean;
    try {
      claimed = this.actions.claimDurable(proposal);
    } catch {
      claimed = true; // durable store unavailable — in-memory truth stands
    }
    if (!claimed) {
      this.pending.delete(event.id);
      return {
        type: 'error',
        id: event.id,
        message: 'proposal was already decided elsewhere (or its durable record expired)',
      };
    }

    if (event.decision === 'reject') {
      this.pending.delete(event.id);
      const resolved: ApprovalServerEvent = {
        type: 'human_gate_resolved',
        id: event.id,
        decision: 'reject',
        resolvedBy,
        detail: event.feedback,
      };
      this.broadcast(resolved);
      return resolved;
    }

    // Approve: the spawn must actually succeed before the proposal leaves
    // the queue. On a failed hail, COMPENSATE: restore the durable record
    // so the proposal survives retries and restarts.
    const result = await this.actions.hail(proposal);
    if (!result.success) {
      try {
        this.actions.restoreDurable(proposal);
      } catch {
        // If restore also fails the proposal still lives in memory for
        // retry within this process; it just won't survive a restart.
      }
      const err: ApprovalServerEvent = {
        type: 'error',
        id: event.id,
        message: `approve failed: ${result.error ?? 'hail refused'} — proposal kept pending`,
      };
      this.broadcast(err);
      return err;
    }
    this.pending.delete(event.id);
    const resolved: ApprovalServerEvent = {
      type: 'human_gate_resolved',
      id: event.id,
      decision: 'approve',
      resolvedBy,
      detail: event.feedback,
    };
    this.broadcast(resolved);
    return resolved;
  }

  /**
   * Fail-closed TTL sweep (stale-context poisoning guard): a gate that sat
   * unanswered for `maxAgeMs` expires — approving days-old trigger context
   * fires an agent on ancient data. Expiry claims the durable record so the
   * gate cannot rehydrate, and broadcasts a resolution so every surface
   * drops it. The trigger can always fire again.
   */
  expireOlderThan(maxAgeMs: number, now: number = Date.now()): number {
    let expired = 0;
    for (const proposal of [...this.pending.values()]) {
      if (now - proposal.timestamp < maxAgeMs) continue;
      this.pending.delete(proposal.id);
      try {
        this.actions?.claimDurable(proposal);
      } catch {
        // Durable cleanup is best-effort; the tuple TTLs out regardless.
      }
      expired += 1;
      this.broadcast({
        type: 'human_gate_resolved',
        id: proposal.id,
        decision: 'expired',
        resolvedBy: 'ttl',
        detail: `unanswered for ${Math.round(maxAgeMs / 3_600_000)}h — expired fail-closed; the trigger can fire again`,
      });
    }
    return expired;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private broadcast(event: ApprovalServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One broken socket must not starve the others.
      }
    }
  }
}

/** Substance identity of a proposal: same project/agent/trigger and the same
 *  trigger content = the same gate, whatever uuid it arrived under. */
function proposalFingerprint(p: PendingApproval): string {
  const content = createHash('sha1')
    .update(p.context.messageContent ?? JSON.stringify(p.context.message ?? ''))
    .digest('hex');
  return `${p.project}/${p.agent}/${p.trigger}/${content}`;
}

let shared: FleetApprovalStream | null = null;
export function getSharedApprovalStream(): FleetApprovalStream {
  if (!shared) shared = new FleetApprovalStream();
  return shared;
}
export function setSharedApprovalStream(stream: FleetApprovalStream | null): void {
  shared = stream;
}

/** Re-export for consumers that only need the context type. */
export type { FleetRunContext };
