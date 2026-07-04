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
      decision: 'approve' | 'reject';
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
  /** Drop the durable fleet:approval tuple for this proposal. */
  removeDurable: (proposal: PendingApproval) => void;
}

type Listener = (event: ApprovalServerEvent) => void;

export class FleetApprovalStream {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly listeners = new Set<Listener>();
  private actions: ApprovalActions | null = null;

  /** The daemon injects what approve/reject DO. Without it, decisions are
   *  refused (fail-closed) — the stream never invents its own spawn path. */
  configure(actions: ApprovalActions): void {
    this.actions = actions;
  }

  /** New proposal from the trust gate (or a boot-time tuple replay). */
  enqueue(proposal: PendingApproval): void {
    if (this.pending.has(proposal.id)) return; // replay-safe
    this.pending.set(proposal.id, proposal);
    this.broadcast({ type: 'human_gate_waiting', proposal });
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

    if (event.decision === 'reject') {
      this.pending.delete(event.id);
      try {
        this.actions.removeDurable(proposal);
      } catch {
        // Durable cleanup is best-effort; the tuple TTLs out regardless.
      }
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
    // the queue — a failed hail keeps it pending so the operator retries
    // instead of the request silently evaporating.
    const result = await this.actions.hail(proposal);
    if (!result.success) {
      const err: ApprovalServerEvent = {
        type: 'error',
        id: event.id,
        message: `approve failed: ${result.error ?? 'hail refused'} — proposal kept pending`,
      };
      this.broadcast(err);
      return err;
    }
    this.pending.delete(event.id);
    try {
      this.actions.removeDurable(proposal);
    } catch {
      // Best-effort; see above.
    }
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
