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
 * Read the most recent deck-log entries for a repo, newest first.
 *
 * PURPOSE: feeds /status and (later) the console's deck-log pane. Bounded by
 * `limit` because the log is permanent — an unbounded read would grow without
 * limit as the seat ages, and no caller ever needs more than a page.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param repo - `owner/repo` the seat serves.
 * @param limit - Maximum rows to return (defaults to 20).
 * @returns Entries newest-first; empty array when unbound or on error.
 */
export async function readDeckLog(
  db: D1Database | undefined,
  repo: string,
  limit = 20,
): Promise<DeckLogEntry[]> {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT repo_full_name, entry_kind, summary, detail, wake_events, created_at
         FROM steward_deck_log WHERE repo_full_name = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(repo, limit)
      .all();
    return (res.results ?? []).map(rowToDeckLog);
  } catch {
    return [];
  }
}

/**
 * Append one merge-ledger verdict row.
 *
 * DESIGN NOTE: nothing writes verdicts in the scaffold — the tick (P1 PR 2)
 * is the first caller. Landing the write path now, tested, means the tick PR
 * changes behavior without also changing the ledger contract, which keeps
 * each PR reviewable on one axis. The verdict vocabulary is CHECK-constrained
 * in the schema as well as typed here: defense at both layers because this
 * table is the repo's merge history of record.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param entry - The verdict; `createdAt` is epoch seconds.
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

/**
 * Read the most recent merge-ledger rows for a repo, newest first.
 *
 * MOTIVATION: the console's "view merge ledger" action (§10) and the tick's
 * own land-fail-loop tripwire both read this projection; bounding it keeps
 * the query cheap forever.
 *
 * @param db - The D1 binding, or undefined when the seat runs unbound.
 * @param repo - `owner/repo` the seat serves.
 * @param limit - Maximum rows to return (defaults to 20).
 * @returns Entries newest-first; empty array when unbound or on error.
 */
export async function readMergeLedger(
  db: D1Database | undefined,
  repo: string,
  limit = 20,
): Promise<MergeLedgerEntry[]> {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT repo_full_name, pr_number, verdict, evidence, requested_by, created_at
         FROM steward_merge_ledger WHERE repo_full_name = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(repo, limit)
      .all();
    return (res.results ?? []).map(rowToMergeLedger);
  } catch {
    return [];
  }
}

/**
 * Map a raw D1 row onto the typed deck-log record.
 *
 * WHY EXPLICIT MAPPING: D1 returns loosely-typed objects keyed by column
 * name; mapping at the boundary keeps snake_case confined to SQL and lets the
 * rest of the seat speak only the typed contract in types.ts.
 *
 * @param row - One row from steward_deck_log.
 * @returns The typed entry.
 */
function rowToDeckLog(row: Record<string, unknown>): DeckLogEntry {
  return {
    repo: String(row.repo_full_name),
    entryKind: row.entry_kind === 'all-quiet' ? 'all-quiet' : 'wake',
    summary: String(row.summary),
    detail: String(row.detail),
    wakeEvents: Number(row.wake_events),
    createdAt: Number(row.created_at),
  };
}

/**
 * Map a raw D1 row onto the typed merge-ledger record.
 *
 * Same boundary-mapping rationale as {@link rowToDeckLog}; the verdict falls
 * back to SURFACE on an unrecognized value because SURFACE is the only
 * verdict that is always safe to over-report — it hands the decision to a
 * human rather than inventing authority.
 *
 * @param row - One row from steward_merge_ledger.
 * @returns The typed entry.
 */
function rowToMergeLedger(row: Record<string, unknown>): MergeLedgerEntry {
  const v = String(row.verdict);
  return {
    repo: String(row.repo_full_name),
    prNumber: Number(row.pr_number),
    verdict: v === 'LAND' || v === 'NEEDS-WORK' ? v : 'SURFACE',
    evidence: String(row.evidence),
    requestedBy: String(row.requested_by),
    createdAt: Number(row.created_at),
  };
}
