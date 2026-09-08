import type { DeckLogEntry, MergeLedgerEntry } from './types.js';

/**
 * Append-only ledger fabric for the Steward's seat, over the shared
 * `port-daddy-relay` D1 database (schema.sql in this package).
 *
 * PHILOSOPHY: notes are immutable evidence; ledgers are curated projections
 * (THE_FULL_WHEEL.md §4). These functions therefore only ever INSERT and
 * SELECT — there is deliberately no update or delete surface in this module,
 * so "rewrite the audit trail" is not an operation the seat can even express.
 * Every write reports success honestly: a missing binding or a thrown D1
 * error returns `false` so the caller can raise its degraded flag, because a
 * ledger that silently drops entries is worse than no ledger at all.
 *
 * WRITES ONLY. The reads used to live here too, and when P1 PR 6 needed them
 * from `apps/relay` they were copied into `apps/shared/steward-ledgers.ts`
 * rather than moved — leaving two SELECTs over the same two tables, which is
 * precisely the drift that module's own docstring exists to forbid. The copies
 * are gone; every reader in both Workers now goes through the shared module.
 * What stays here is what ADR-0109 says must: the seat is the single WRITER of
 * its own history, and that is a property a shared write path would destroy.
 * A shared reader cannot violate single-writer; a shared writer can.
 */

/**
 * Append one deck-log entry — the seat's per-wake vital sign.
 *
 * WHY FALSE INSTEAD OF THROW: the deck log is written at the end of every
 * wake, including wakes whose whole purpose was to report trouble. If this
 * write threw, a D1 outage would turn every wake into a crash loop and the
 * seat would fall silent — the exact failure the deck log exists to make
 * impossible. The caller keeps a bounded DO-storage fallback ring instead.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param entry - The completed entry; `createdAt` is epoch seconds.
 * @returns True when the row landed in D1; false on missing binding or error.
 */
export async function appendDeckLog(db: D1Database | undefined, entry: DeckLogEntry): Promise<boolean> {
  if (!db) return false;
  try {
    await db
      .prepare(
        `INSERT INTO steward_deck_log (repo_full_name, entry_kind, summary, detail, wake_events, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(entry.repo, entry.entryKind, entry.summary, entry.detail, entry.wakeEvents, entry.createdAt)
      .run();
    return true;
  } catch {
    return false;
  }
}

/**
 * Append one merge-ledger verdict row — the repo's merge history of record.
 *
 * SAME FAIL-SOFT RATIONALE as {@link appendDeckLog}, with one addition: this
 * table is the answer to "why did the Steward merge that", so the verdict
 * vocabulary is CHECK-constrained in the schema as well as typed here.
 * Defense at both layers, because a row that lands with a verdict nobody can
 * interpret is worse than a row that never lands — the first corrupts the
 * record, the second only shortens it, and the caller is told either way.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param entry - The rendered verdict; `createdAt` is epoch seconds.
 * @returns True when the row landed in D1; false on missing binding or error.
 */
export async function appendMergeVerdict(
  db: D1Database | undefined,
  entry: MergeLedgerEntry,
): Promise<boolean> {
  if (!db) return false;
  try {
    await db
      .prepare(
        `INSERT INTO steward_merge_ledger (repo_full_name, pr_number, verdict, evidence, requested_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(entry.repo, entry.prNumber, entry.verdict, entry.evidence, entry.requestedBy, entry.createdAt)
      .run();
    return true;
  } catch {
    return false;
  }
}
