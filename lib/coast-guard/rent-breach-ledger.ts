/**
 * The compulsion — rent-breach ledger (ADR-0050, phase 7).
 *
 * Escalation needs memory. `rent-slash.ts` grades the slash by `breachCount`,
 * but a breach count only escalates if it SURVIVES across commits — otherwise
 * every breach looks like a first miss and the loop can never bite a persistent
 * dark-laner. This module is that memory: a small per-principal SQLite ledger
 * that counts un-cured rent breaches.
 *
 * GRADUATED, NOT GRIM (doctrine: game-theory.md §4). A crash and a deliberate
 * defection are indistinguishable to an outside observer, so punishment must be
 * forgiving:
 *
 *   • recordBreach(principal) → increments and returns the current count.
 *   • cure(principal)         → the principal paid rent again (published a note
 *                               per commit); DECAY the count by one toward zero.
 *     A sustained cooperator walks the escalation back down to grace, exactly
 *     like the k-round reset in a graduated trigger — not punished forever for a
 *     transient lapse.
 *   • A breach older than `resetWindowMs` with no activity is treated as a fresh
 *     start (the clock the daemon supplies, never the agent — Law 1).
 *
 * The ledger keys on the PRINCIPAL (Anchor / semantic identity), never a
 * re-rollable agent id — escalation a Sybil could shed by re-rolling would be no
 * escalation at all (ADR-0014/0022).
 *
 * Module-factory pattern (createFoo(db)); the table self-initializes
 * idempotently. The clock is always injected (`now`) so the ledger is pure
 * w.r.t. wall time and unit-testable.
 */

import type Database from 'better-sqlite3';

export interface RentBreachLedgerPolicy {
  /** A principal silent (no breach, no cure) longer than this is reset to a
   *  clean slate on its next breach — a stale escalation is not held forever.
   *  Default 24h: long enough that a genuine repeat offender within a workday
   *  still escalates; short enough that yesterday's lapse doesn't fine today. */
  resetWindowMs: number;
}

export const DEFAULT_RENT_BREACH_LEDGER_POLICY: RentBreachLedgerPolicy = {
  resetWindowMs: 24 * 60 * 60 * 1000,
};

interface BreachRow {
  principal: string;
  project: string;
  breach_count: number;
  first_breach_at: number;
  last_event_at: number;
}

export interface BreachState {
  principal: string;
  project: string;
  breachCount: number;
  firstBreachAt: number;
  lastEventAt: number;
}

export function createRentBreachLedger(
  db: Database.Database,
  policy: RentBreachLedgerPolicy = DEFAULT_RENT_BREACH_LEDGER_POLICY,
) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS rent_breach_ledger (
      principal        TEXT PRIMARY KEY,
      project          TEXT NOT NULL,
      breach_count     INTEGER NOT NULL DEFAULT 0,
      first_breach_at  INTEGER NOT NULL,
      last_event_at    INTEGER NOT NULL
    )
  `).run();

  const selectRow = db.prepare<[string], BreachRow>(
    `SELECT principal, project, breach_count, first_breach_at, last_event_at
       FROM rent_breach_ledger WHERE principal = ?`,
  );
  const upsertBreach = db.prepare<[string, string, number, number, number]>(`
    INSERT INTO rent_breach_ledger (principal, project, breach_count, first_breach_at, last_event_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(principal) DO UPDATE SET
      project         = excluded.project,
      breach_count    = excluded.breach_count,
      first_breach_at = excluded.first_breach_at,
      last_event_at   = excluded.last_event_at
  `);
  const updateCount = db.prepare<[number, number, string]>(
    `UPDATE rent_breach_ledger SET breach_count = ?, last_event_at = ? WHERE principal = ?`,
  );

  function toState(row: BreachRow | undefined): BreachState | null {
    if (!row) return null;
    return {
      principal: row.principal,
      project: row.project,
      breachCount: row.breach_count,
      firstBreachAt: row.first_breach_at,
      lastEventAt: row.last_event_at,
    };
  }

  /**
   * Record a rent breach for a principal and return the post-increment count
   * (1 = first miss). If the principal's last event was longer ago than
   * `resetWindowMs`, the escalation starts fresh (count becomes 1) — a stale
   * grudge is not carried into a new working day.
   *
   * @param now Caller-supplied clock (Law 1). The daemon supplies a
   *   monotonic-safe wall value; tests inject a fixed clock.
   */
  function recordBreach(principal: string, project: string, now: number): number {
    if (!Number.isFinite(now)) {
      throw new Error('rentBreachLedger.recordBreach: now must be a finite number (Law 1)');
    }
    const existing = selectRow.get(principal);
    const stale = !existing || now - existing.last_event_at > policy.resetWindowMs;
    const nextCount = stale ? 1 : existing.breach_count + 1;
    const firstAt = stale ? now : existing.first_breach_at;
    upsertBreach.run(principal, project, nextCount, firstAt, now);
    return nextCount;
  }

  /**
   * The principal paid rent again — decay the escalation by one toward zero
   * (graduated, not grim). A sustained cooperator walks back to grace. Returns
   * the post-decay count (>= 0). A principal with no ledger row is already at 0.
   */
  function cure(principal: string, now: number): number {
    if (!Number.isFinite(now)) {
      throw new Error('rentBreachLedger.cure: now must be a finite number (Law 1)');
    }
    const existing = selectRow.get(principal);
    if (!existing || existing.breach_count <= 0) return 0;
    const nextCount = Math.max(0, existing.breach_count - 1);
    updateCount.run(nextCount, now, principal);
    return nextCount;
  }

  /** Read the current breach state for a principal, or null if none recorded. */
  function getState(principal: string): BreachState | null {
    return toState(selectRow.get(principal));
  }

  return { recordBreach, cure, getState };
}

export type RentBreachLedger = ReturnType<typeof createRentBreachLedger>;
