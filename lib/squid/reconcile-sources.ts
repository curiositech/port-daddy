/**
 * Adapters from Port Daddy's durable stores to the Ink Cloud reconcile contract.
 *
 * The reconcile loop (`lib/squid/reconcile.ts`) knows nothing about sessions,
 * inboxes, parleys or telemetry — it takes six synchronous thunks and projects
 * whatever they return. This module is the other half of that seam: the place
 * where `session_files` rows become a `ClaimOverlap` and a `ParleySummary`
 * becomes a per-actor `ParleySummons`.
 *
 * **Why a separate module rather than closures in `server.ts`.** These mappings
 * carry real decisions — which parley participants count as summoned, what makes
 * a claim *contested* rather than merely held, when CI is allowed to say "green".
 * Each one is a place a bug hides silently, because a wrong mapping still
 * type-checks and still projects *something*. Here they are unit-testable
 * against fake stores without booting a daemon; in `server.ts` they would only
 * ever be exercised by a running server.
 *
 * **The invariant every adapter in this file preserves.** Returning `[]` is a
 * factual claim — "I looked, and there are none" — and the loop acts on it by
 * garbage-collecting that class's keys. An adapter that cannot see its store
 * must therefore never be wired at all (the source stays absent, the class stays
 * degraded, existing keys survive) rather than reporting empty. Each factory
 * below returns a thunk only when its store can actually answer; the CI one is
 * the sharp case and documents itself.
 */

import type {
  Accomplishment,
  CiFailure,
  ClaimOverlap,
  InboxMessage,
  ParleySummons,
} from './reconcile.js';

// ─── Store shapes (structural, so tests can pass fakes) ──────────────────────

/** The slice of `createAgentInbox()` this adapter needs. */
export interface InboxStore {
  listAllUnread(limit?: number): ReadonlyArray<{
    readonly id: number;
    readonly agentId: string;
    readonly from: string | null;
    readonly content: unknown;
    readonly createdAt: number;
  }>;
}

/** The slice of `createSessions()` this adapter needs. */
export interface SessionsStore {
  listAllActiveClaims(options?: Record<string, unknown>): {
    readonly claims: ReadonlyArray<{
      readonly filePath: string;
      readonly sessionId: string;
      readonly agentId?: string | null;
      readonly claimedAt: number;
    }>;
  };
  list(options?: Record<string, unknown>): unknown;
}

/** The slice of `createParley()` this adapter needs. */
export interface ParleyStore {
  list(options?: { limit?: number }): ReadonlyArray<{
    readonly parley: {
      readonly parleyId: string;
      readonly reason: string;
      readonly parties: readonly string[];
      readonly createdAt: number;
    };
    readonly status: string;
    readonly missingParties: readonly string[];
    readonly expired: boolean;
  }>;
}

/** The slice of `createCloudAppTelemetry()` this adapter needs. */
export interface TelemetryStore {
  recent(
    limit?: number,
    since?: number,
  ): ReadonlyArray<{
    readonly event: string | null;
    readonly conclusion: string | null;
    readonly owner: string | null;
    readonly repo: string | null;
    readonly prNumber: number | null;
    readonly sha: string | null;
    readonly ts: number;
    readonly metadata?: Record<string, unknown> | null;
  }>;
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Fleet-wide unread ceiling per tick. The loop caps per-actor downstream. */
export const INBOX_SCAN_LIMIT = 500;
/** How far back a completed session still counts as an accomplishment. */
export const ACCOMPLISHMENT_WINDOW_MS = 900_000; // 15 min — matches the class TTL
/** How far back a red check is still worth telling agents about. */
export const CI_WINDOW_MS = 3_600_000; // 1 hour
/** Parley summaries scanned per tick. */
export const PARLEY_SCAN_LIMIT = 50;

// ─── INBOX ───────────────────────────────────────────────────────────────────

/**
 * Every unread message, addressed to its recipient.
 *
 * `msgId` is the inbox row's primary key, so the same message mints the same
 * matrix key on every tick — that stability is what lets the loop overwrite
 * rather than accumulate, and what lets GC recognise a message as *the same one*
 * after it is read.
 */
export function inboxSource(store: InboxStore): () => readonly InboxMessage[] {
  return () =>
    store.listAllUnread(INBOX_SCAN_LIMIT).map((m) => ({
      actor: m.agentId,
      msgId: String(m.id),
      summary: oneLine(m.content),
      ...(m.from ? { from: m.from } : {}),
      ts: m.createdAt,
    }));
}

// ─── CLAIMS ──────────────────────────────────────────────────────────────────

/**
 * Files that more than one live session is holding at once.
 *
 * **A claim is not news; an overlap is.** Every active session holds claims, and
 * projecting all of them would flood the matrix with the fleet's entire working
 * set — noise that is true but useless. What an agent needs to know is the
 * subset where someone else is standing on the same file, so the grouping below
 * keeps only paths with two or more DISTINCT session holders.
 *
 * Distinct by `sessionId`, not by row: one session claiming three regions of a
 * file is one holder, and counting rows would report a phantom overlap against
 * itself — the kind of false alarm that teaches agents to ignore the channel.
 */
export function claimsSource(store: SessionsStore): () => readonly ClaimOverlap[] {
  return () => {
    const byPath = new Map<string, { holders: Set<string>; ts: number }>();
    for (const c of store.listAllActiveClaims().claims) {
      const entry = byPath.get(c.filePath) ?? { holders: new Set<string>(), ts: 0 };
      entry.holders.add(c.agentId || c.sessionId);
      // Newest claim on the path dates the overlap: that is the moment the
      // contention actually began, not when the first holder arrived.
      entry.ts = Math.max(entry.ts, c.claimedAt);
      byPath.set(c.filePath, entry);
    }
    const overlaps: ClaimOverlap[] = [];
    for (const [path, { holders, ts }] of byPath) {
      if (holders.size < 2) continue;
      overlaps.push({ path, holders: [...holders].sort(), ts });
    }
    return overlaps;
  };
}

// ─── PARLEY ──────────────────────────────────────────────────────────────────

/**
 * One summons per (actor still owing a reply, conversation).
 *
 * Fans out over `missingParties` rather than `parties`: a participant who has
 * already spoken is not waiting on anything, and re-summoning them every tick
 * until the parley closes would make the loudest class in the matrix also the
 * least actionable one. Terminal and expired parleys drop out entirely — the
 * loop's GC then removes their keys, which is how a resolved parley goes quiet
 * without anyone explicitly retracting it.
 */
export function parleySource(store: ParleyStore): () => readonly ParleySummons[] {
  const TERMINAL = new Set(['COLLAPSED', 'ESCALATED', 'VOIDED']);
  return () => {
    const out: ParleySummons[] = [];
    for (const s of store.list({ limit: PARLEY_SCAN_LIMIT })) {
      if (TERMINAL.has(s.status) || s.expired) continue;
      for (const actor of s.missingParties) {
        out.push({
          actor,
          convId: s.parley.parleyId,
          summary: s.parley.reason,
          ts: s.parley.createdAt,
        });
      }
    }
    return out;
  };
}

// ─── ACCOMPLISHMENTS ─────────────────────────────────────────────────────────

/**
 * Work the fleet finished recently — the lowest-priority, first-dropped class.
 *
 * Windowed to {@link ACCOMPLISHMENT_WINDOW_MS} because ambience has a shelf
 * life: a session that closed an hour ago is history, not news, and letting the
 * class grow unbounded would spend an agent's whole turn budget on trivia that
 * outranks nothing.
 */
export function accomplishmentsSource(
  store: SessionsStore,
  now: () => number = Date.now,
): () => readonly Accomplishment[] {
  return () => {
    const cutoff = now() - ACCOMPLISHMENT_WINDOW_MS;
    const listed = store.list({ status: 'completed', allWorktrees: true, limit: 25 });
    const rows = extractSessionRows(listed);
    const out: Accomplishment[] = [];
    for (const r of rows) {
      const ts = typeof r.completedAt === 'number' ? r.completedAt : null;
      if (ts === null || ts < cutoff) continue;
      const summary = typeof r.purpose === 'string' && r.purpose.trim() ? r.purpose.trim() : 'work completed';
      out.push({ id: String(r.id), summary: oneLine(summary), ts });
    }
    return out;
  };
}

// ─── CI ──────────────────────────────────────────────────────────────────────

/**
 * Whether CI ingestion is live enough for silence to mean "green".
 *
 * **This is the whole reason the CI adapter is shaped differently from the other
 * four.** For every other class, `[]` means "no items" and is harmless. For CI,
 * `null` is a positive assertion — *the branch is green* — so a daemon with no
 * telemetry ingestion configured would answer `null` from an empty table and
 * tell every agent in the fleet that a build it has never observed is passing.
 * That is worse than saying nothing.
 *
 * So the source is only ever wired when this probe finds evidence that events
 * actually arrive. Absent that, the class stays degraded: no projection, no GC,
 * whatever is in the matrix is left alone.
 *
 * @returns `true` when at least one telemetry event has ever been recorded.
 */
export function ciIngestionIsLive(store: TelemetryStore): boolean {
  try {
    return store.recent(1, 0).length > 0;
  } catch {
    // A store that cannot be queried is exactly the case this probe exists to
    // catch — fail closed, leave CI degraded.
    return false;
  }
}

/**
 * The most recent red check, or `null` when nothing is failing in the window.
 *
 * Only meaningful when {@link ciIngestionIsLive} — see its note on why `null`
 * here is a claim rather than an absence.
 *
 * Branch naming is best-effort by design: the telemetry table stores `sha` and
 * `pr_number` but no branch column, so this prefers an explicit branch in the
 * event metadata, falls back to `PR #<n>`, then to a short sha. The label only
 * has to identify the failing work to a human, and inventing a plausible-looking
 * branch name would be worse than an honest `PR #4925`.
 */
export function ciSource(
  store: TelemetryStore,
  now: () => number = Date.now,
): () => CiFailure | null {
  return () => {
    const since = now() - CI_WINDOW_MS;
    const events = store.recent(200, since);
    for (const e of events) {
      // `recent()` is ordered newest-first, so the first failure is the latest.
      if ((e.conclusion ?? '').toLowerCase() !== 'failure') continue;
      const meta = e.metadata ?? {};
      const branch =
        pickString(meta['branch']) ??
        pickString(meta['head_branch']) ??
        (typeof e.prNumber === 'number' ? `PR #${e.prNumber}` : null) ??
        (e.sha ? e.sha.slice(0, 8) : null) ??
        'unknown branch';
      const where = e.owner && e.repo ? `${e.owner}/${e.repo}` : 'repo';
      return {
        branch,
        summary: oneLine(`${e.event ?? 'check'} failed on ${where}`),
        ts: e.ts,
      };
    }
    return null;
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Longest one-line summary any adapter emits, before the loop's own budget. */
export const SUMMARY_MAX = 160;

/**
 * Flatten arbitrary stored content into one budget-safe line.
 *
 * Inbox `content` is an unknown blob (the column is untyped on purpose), so this
 * has to survive objects, nulls and multi-KB strings. Newlines are collapsed
 * because the matrix is a flat `KEY="value"` file — an embedded newline there
 * does not just look bad, it ends the line the shell hook is parsing.
 */
export function oneLine(value: unknown): string {
  let s: string;
  if (typeof value === 'string') s = value;
  else if (value === null || value === undefined) s = '';
  else if (typeof value === 'object') {
    const text = (value as Record<string, unknown>)['text'] ?? (value as Record<string, unknown>)['message'];
    s = typeof text === 'string' ? text : safeJson(value);
  } else s = String(value);

  const flat = s.replace(/\s+/g, ' ').trim();
  if (!flat) return '(empty)';
  return flat.length > SUMMARY_MAX ? `${flat.slice(0, SUMMARY_MAX - 1)}…` : flat;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

interface SessionRowish {
  readonly id: unknown;
  readonly purpose?: unknown;
  readonly completedAt?: unknown;
}

/**
 * Pull session rows out of whatever `sessions.list()` returned.
 *
 * The store's list surface has grown several shapes over time (a bare array, a
 * `{ sessions }` envelope). Rather than pin one and break on the others — a
 * throwing source degrades the class — this accepts any of them and yields
 * nothing for a shape it does not recognise.
 */
function extractSessionRows(listed: unknown): readonly SessionRowish[] {
  if (Array.isArray(listed)) return listed as SessionRowish[];
  if (listed && typeof listed === 'object') {
    const inner = (listed as Record<string, unknown>)['sessions'];
    if (Array.isArray(inner)) return inner as SessionRowish[];
  }
  return [];
}
