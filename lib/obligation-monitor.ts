/**
 * Obligation Monitor — the dual of resurrection (ADR-0041).
 *
 * Resurrection (`lib/resurrection.ts`) sweeps heartbeats and flags DEAD agents.
 * This sweeps commitments (`lib/commitments.ts`) and flags BROKEN PROMISES: open
 * commitments whose daemon-derived `due_at` has passed with content still unmet.
 * Per **runtime verification** (Leucker & Schallhart 2009 — compiling a property
 * into an online monitor over an event stream), it turns "the agent will close
 * what it claimed" into a continuously-checked property.
 *
 * Five-laws hardening enforced HERE:
 *
 *   Law 1 (clock outside agent control + sleep-aware): `checkOverdue(now)` takes
 *     the current time as a PARAMETER so the daemon — not the commitment row, not
 *     the agent — supplies it. The daemon feeds a monotonic-safe value and skips
 *     the sweep during the post-sleep grace period (same mechanism resurrection
 *     uses), so laptop sleep does not instantly mark every commitment overdue.
 *     We deliberately do NOT call Date.now() inside the sweep.
 *
 *   Law 4 (fail closed, never silently degrade): this is a PURE runtime rule over
 *     SQLite rows, exactly like HEARTBEAT_FRESHNESS in resurrection. It has NO
 *     dependency on the Rust Arbiter enforcer FFI, so it cannot silently degrade
 *     to a no-op stub on an install missing the prebuilt lib. It always actually
 *     checks.
 *
 * Out of scope for this slice: the graduated sanction ladder (where escalation
 * after the grace window lands), the accountability ledger, and the sampled
 * adversarial auditor (Law 2 hollow-compliance defense) — all separate ADRs.
 * This module's job is detection + the OBLIGATION_OVERDUE signal.
 */

import type Database from 'better-sqlite3';
import type { Commitment } from './commitments.js';

/** Activity event type emitted when an open commitment passes its deadline. */
export const OBLIGATION_OVERDUE = 'obligation:overdue';

/** Minimal slice of the activity log we depend on. */
interface ActivityLogMin {
  log(
    type: string,
    options?: {
      agentId?: string | null;
      targetId?: string | null;
      details?: string | null;
      metadata?: Record<string, unknown> | null;
    },
  ): { success: boolean };
}

export interface ObligationMonitorDeps {
  /** Activity log for emitting OBLIGATION_OVERDUE. Optional (degrades to no emit). */
  activityLog?: ActivityLogMin;
}

export interface OverdueCommitment {
  id: string;
  ownerActorId: string;
  objectText: string;
  dueAt: number;
  overdueByMs: number;
  scope: string;
  commitmentStrategy: string;
}

export interface CheckOverdueResult {
  success: true;
  /** The commitments found overdue on this sweep. */
  overdue: OverdueCommitment[];
  count: number;
  /** The `now` the sweep was evaluated against (echoed for traceability). */
  checkedAt: number;
}

interface OpenCommitmentRow {
  id: string;
  owner_actor_id: string;
  object_text: string;
  due_at: number;
  scope: string;
  commitment_strategy: string;
}

export function createObligationMonitor(
  db: Database.Database,
  deps: ObligationMonitorDeps = {},
) {
  // Select open, past-due commitments. "Not satisfied" == still 'open': a closed
  // commitment has left the 'open' state (Law 2 closure binds to an oracle), and
  // an abandoned/superseded one is likewise no longer owed.
  const selectOverdue = db.prepare<[number], OpenCommitmentRow>(`
    SELECT id, owner_actor_id, object_text, due_at, scope, commitment_strategy
      FROM commitments
     WHERE state = 'open' AND due_at < ?
     ORDER BY due_at ASC
  `);

  /**
   * Sweep for overdue commitments. Mirrors `resurrection.check`'s structure but
   * over promises rather than heartbeats.
   *
   * @param now The current time, supplied BY THE CALLER (Law 1). The daemon
   *   passes a monotonic-safe wall value and skips this entirely during the
   *   post-sleep grace period. Tests inject a fixed clock.
   */
  function checkOverdue(now: number): CheckOverdueResult {
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new Error('obligationMonitor.checkOverdue: now must be a finite number (Law 1: caller supplies the clock)');
    }

    const rows = selectOverdue.all(now);
    const overdue: OverdueCommitment[] = rows.map((row) => ({
      id: row.id,
      ownerActorId: row.owner_actor_id,
      objectText: row.object_text,
      dueAt: row.due_at,
      overdueByMs: now - row.due_at,
      scope: row.scope,
      commitmentStrategy: row.commitment_strategy,
    }));

    // Emit one OBLIGATION_OVERDUE per overdue commitment so downstream actors
    // (future sanction ladder, dashboards) can react per-promise.
    if (deps.activityLog) {
      for (const c of overdue) {
        deps.activityLog.log(OBLIGATION_OVERDUE, {
          agentId: c.ownerActorId,
          targetId: c.id,
          details: `Commitment overdue by ${Math.round(c.overdueByMs / 1000)}s: ${c.objectText}`,
          metadata: {
            commitmentId: c.id,
            ownerActorId: c.ownerActorId,
            dueAt: c.dueAt,
            overdueByMs: c.overdueByMs,
            scope: c.scope,
            commitmentStrategy: c.commitmentStrategy,
          },
        });
      }
    }

    return { success: true, overdue, count: overdue.length, checkedAt: now };
  }

  return {
    checkOverdue,
    OBLIGATION_OVERDUE,
  };
}

export type ObligationMonitor = ReturnType<typeof createObligationMonitor>;

/** Re-export so callers can type overdue lists without importing commitments. */
export type { Commitment };
