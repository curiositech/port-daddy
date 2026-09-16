/**
 * apps/shared/steward-ledgers.ts — the Steward's two append-only ledgers,
 * READ-ONLY, shared between `apps/steward` (which writes them) and
 * `apps/relay` (which renders them at `/account/steward`).
 *
 * Why shared, and why read-only: both Workers bind the same D1 database
 * (`port-daddy-relay`, `binding = "DB"` in both `wrangler.deploy.toml` files),
 * so the relay reads the seat's tables directly — no service binding, no
 * network hop. The same discipline `apps/shared/repo-ai-settings.ts` already
 * established for this repo: two independently-edited copies of one SELECT
 * drift silently, and the drift is invisible until a column rename makes the
 * console quietly render an empty page.
 *
 * Only the READ half lives here. Writes stay in `apps/steward/src/ledgers.ts`
 * and stay the seat's alone — ADR-0109's single-writer rule is the reason the
 * merge history of record can be trusted, and a shared writer would be the
 * first crack in it. A reader cannot violate single-writer; a writer can.
 *
 * WHY THIS FILE EXISTS AT ALL (the P1 lesson, made structural): the seat wrote
 * a perfect vital sign for its entire existence and nothing could display it.
 * `steward_deck_log` had zero rows for four green PRs and the only way to
 * learn that was a terminal and a secret. A ledger no operator can read is not
 * an audit trail — it is a file. This module is the half that makes it a
 * surface.
 */

/** The minimal D1 surface these readers need (both Workers' `env.DB`). */
export interface StewardLedgerDb {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results?: T[] }>;
    };
  };
}

/**
 * One deck-log entry — the seat's vital sign (§5.3: a wake that writes no
 * entry is a failed wake, ALL QUIET included).
 */
export interface StewardDeckLogRow {
  /** Repo the seat serves, `owner/repo`. */
  repo: string;
  /** `wake` when stimuli were processed, `all-quiet` for an empty-inbox beat. */
  entryKind: 'wake' | 'all-quiet';
  /** Human-readable one-liner a cold reader can follow. */
  summary: string;
  /** JSON-encoded structured context (drained events, charter version, tick). */
  detail: string;
  /** How many wake events this entry accounts for (0 for all-quiet). */
  wakeEvents: number;
  /** Epoch seconds. */
  createdAt: number;
}

/** One merge-ledger row — every verdict the seat ever rendered (§4). */
export interface StewardMergeLedgerRow {
  /** Repo the verdict concerns, `owner/repo`. */
  repo: string;
  /** The PR judged. */
  prNumber: number;
  /** The seat's three-valued vocabulary — nothing else is ever valid. */
  verdict: 'LAND' | 'NEEDS-WORK' | 'SURFACE';
  /** Evidence a stranger can check; never empty. */
  evidence: string;
  /** Who asked — `tick`, `operator`, or a re-request source. */
  requestedBy: string;
  /** Epoch seconds. */
  createdAt: number;
}

/** Default page size; the ledgers are permanent, so reads are always bounded. */
export const STEWARD_LEDGER_PAGE = 20;

/**
 * Read the most recent deck-log entries for a repo, newest first.
 *
 * DESIGN — DEGRADES TO EMPTY, NEVER THROWS: this feeds an operator page, and a page
 * that 500s tells a reader less than a page that renders "no entries yet" —
 * which is itself the finding worth seeing, since an empty deck log is
 * precisely what a dead seat looks like. The caller distinguishes "empty" from
 * "unavailable" by whether the seat header alongside it resolved.
 *
 * @param db - The D1 binding, or undefined when unbound.
 * @param repo - `owner/repo` the seat serves.
 * @param limit - Maximum rows (defaults to {@link STEWARD_LEDGER_PAGE}).
 * @returns Entries newest-first; empty array when unbound or on error.
 */
export async function readStewardDeckLog(
  db: StewardLedgerDb | undefined,
  repo: string,
  limit = STEWARD_LEDGER_PAGE,
): Promise<StewardDeckLogRow[]> {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT repo_full_name, entry_kind, summary, detail, wake_events, created_at
         FROM steward_deck_log WHERE repo_full_name = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(repo, limit)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map(row => ({
      repo: String(row.repo_full_name ?? ''),
      // Anything unrecognized reads as a wake rather than all-quiet: an
      // unexpected value must not be able to disguise itself as the quiet
      // case, which is the one an operator scrolls past.
      entryKind: row.entry_kind === 'all-quiet' ? 'all-quiet' : 'wake',
      summary: String(row.summary ?? ''),
      detail: String(row.detail ?? ''),
      wakeEvents: Number(row.wake_events ?? 0),
      createdAt: Number(row.created_at ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * Read the most recent merge-ledger verdicts for a repo, newest first.
 *
 * Same degradation contract as {@link readStewardDeckLog} and for the same
 * reason: the verdict history is what an operator checks when asking "why did
 * it merge that", and an error page answers nothing.
 *
 * @param db - The D1 binding, or undefined when unbound.
 * @param repo - `owner/repo` the seat serves.
 * @param limit - Maximum rows (defaults to {@link STEWARD_LEDGER_PAGE}).
 * @returns Verdicts newest-first; empty array when unbound or on error.
 */
export async function readStewardMergeLedger(
  db: StewardLedgerDb | undefined,
  repo: string,
  limit = STEWARD_LEDGER_PAGE,
): Promise<StewardMergeLedgerRow[]> {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT repo_full_name, pr_number, verdict, evidence, requested_by, created_at
         FROM steward_merge_ledger WHERE repo_full_name = ? ORDER BY id DESC LIMIT ?`,
      )
      .bind(repo, limit)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map(row => ({
      repo: String(row.repo_full_name ?? ''),
      prNumber: Number(row.pr_number ?? 0),
      verdict: normalizeVerdict(row.verdict),
      evidence: String(row.evidence ?? ''),
      requestedBy: String(row.requested_by ?? ''),
      createdAt: Number(row.created_at ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * List the repos that have ever had a seat, newest activity first.
 *
 * PURPOSE: the console cannot know the roster — `STEWARD_REPOS` lives in the
 * steward Worker's config, not the relay's. Deriving it from the ledger means
 * the page shows exactly the seats that have actually done something, which is
 * the honest set: a repo configured but never woken has nothing to display and
 * should not appear as though it does.
 *
 * @param db - The D1 binding, or undefined when unbound.
 * @param limit - Maximum repos to return.
 * @returns `owner/repo` names ordered by most recent deck-log entry.
 */
export async function listStewardRepos(
  db: StewardLedgerDb | undefined,
  limit = 25,
): Promise<string[]> {
  if (!db) return [];
  try {
    const res = await db
      .prepare(
        `SELECT repo_full_name, MAX(created_at) AS last_seen
         FROM steward_deck_log GROUP BY repo_full_name
         ORDER BY last_seen DESC LIMIT ?`,
      )
      .bind(limit)
      .all<Record<string, unknown>>();
    return (res.results ?? []).map(r => String(r.repo_full_name ?? '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Constrain a stored verdict to the three-valued vocabulary.
 *
 * WHY NOT TRUST THE COLUMN: the schema CHECK-constrains it, but this reader
 * runs in a different Worker than the writer and against a database an older
 * or newer deployment may have touched. Defaulting an unknown value to
 * SURFACE is the safe direction — it renders as "needs a human", never as a
 * landing this seat did not authorize.
 *
 * @param raw - The stored value, of unverified type.
 * @returns One of the three valid verdicts.
 */
function normalizeVerdict(raw: unknown): 'LAND' | 'NEEDS-WORK' | 'SURFACE' {
  return raw === 'LAND' || raw === 'NEEDS-WORK' ? raw : 'SURFACE';
}
