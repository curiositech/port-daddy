/**
 * Suggestions — durable, dismissible coaching records for active agents (ADR-0039).
 *
 * The suggestibility layer's storage + lifecycle half. A *suggestion* is something
 * the substrate noticed that an agent would want to know — today, only that another
 * live session is working the same surface (`claim-overlap-headsup`). This module
 * owns the table and the accept/decline/mute/cooldown/budget machinery; the
 * detection that fills it lives in `lib/suggestion-broker.ts`, and delivery rides
 * the existing inbox → `pd attention` surface (no new channel, per ADR-0039 §Primitive 3).
 *
 * Coaching, not coordination: a suggestion is a nudge the agent may decline. The
 * teeth (forced reconciliation) belong to parley (ADR-0055), which consumes the
 * same overlap signal as a trigger. This module deliberately has none.
 *
 * Noise is the failure mode the ADR names first (§Risks #1). Three dampers, all
 * here: a per-(agent, kind, payloadHash) **cooldown** so a re-scan of the same
 * standing overlap doesn't re-nag; a per-agent hourly **budget**; and an explicit
 * per-(agent, kind) **mute**. Suppressed suggestions are reported back to the
 * caller with a reason so the broker can log them for tuning rather than dropping
 * them silently.
 *
 * Mirrors the module-factory pattern: `createSuggestions(db)` returns a methods
 * object, self-initializes its tables with idempotent CREATE TABLE IF NOT EXISTS,
 * and uses prepared statements throughout (see `lib/commitments.ts`).
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

/** pending → the agent hasn't acted; the rest are terminal. */
export type SuggestionStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'muted';

/** The only kind shipped in this slice. New kinds (group-chat-proposal,
 *  prior-art-doc, salvage-candidate) land with the semantic classifier. */
export type SuggestionKind =
  | 'claim-overlap-headsup'
  | 'claim-tree-trouble'
  | 'group-chat-proposal'
  | 'prior-art-doc'
  | 'salvage-candidate';

export interface Suggestion {
  id: number;
  agentId: string;
  kind: SuggestionKind;
  payload: unknown;
  payloadHash: string;
  confidence: number;
  status: SuggestionStatus;
  createdAt: number;
  actedOnAt: number | null;
  mutedUntil: number | null;
}

export interface CreateSuggestionInput {
  agentId: string;
  kind: SuggestionKind;
  payload: unknown;
  /** Stable across re-detections of the same underlying fact, so cooldown can
   *  dedup. If omitted, derived from a hash of (kind + payload). */
  payloadHash?: string;
  confidence?: number;
}

/** Why a create() call did not surface a suggestion. Logged for tuning. */
export type SuppressionReason = 'cooldown' | 'budget' | 'muted';

export type CreateSuggestionResult =
  | { created: true; suggestion: Suggestion }
  | { created: false; reason: SuppressionReason; existingId?: number };

export interface SuggestionsPolicy {
  /** Re-suggesting the same (agent, kind, payloadHash) is suppressed for this long
   *  after the last create/decline. ADR-0039 default: 4h. */
  cooldownMs: number;
  /** Hard cap of surfaced suggestions per agent per rolling hour. ADR-0039: 6. */
  hourlyBudget: number;
  /** Default confidence when a caller omits one. */
  defaultConfidence: number;
  /** Suggestions at/above this confidence are PRIORITY: they bypass `hourlyBudget`
   *  (so a flood of trivial overlaps can't starve a critical one — red-team smell
   *  S5, importance-blind rate-limiting) and instead count against the separate,
   *  higher `priorityHourlyBudget` so even "critical" cannot spam without bound. */
  priorityConfidence: number;
  /** Hard cap of PRIORITY suggestions per agent per rolling hour. */
  priorityHourlyBudget: number;
}

export const DEFAULT_SUGGESTIONS_POLICY: SuggestionsPolicy = {
  cooldownMs: 4 * 60 * 60 * 1000,
  hourlyBudget: 6,
  defaultConfidence: 0.9,
  priorityConfidence: 0.95,
  priorityHourlyBudget: 24,
};

export interface SuggestionsDeps {
  now?: () => number;
  policy?: Partial<SuggestionsPolicy>;
}

interface SuggestionRow {
  id: number;
  agent_id: string;
  kind: string;
  payload: string;
  payload_hash: string;
  confidence: number;
  status: string;
  created_at: number;
  acted_on_at: number | null;
  muted_until: number | null;
}

function hashPayload(kind: string, payload: unknown): string {
  return createHash('sha256')
    .update(kind)
    .update('\u0000')
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload ?? null))
    .digest('hex')
    .slice(0, 32);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function createSuggestions(db: Database.Database, deps: SuggestionsDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const policy: SuggestionsPolicy = { ...DEFAULT_SUGGESTIONS_POLICY, ...(deps.policy ?? {}) };

  db.exec(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      acted_on_at INTEGER,
      muted_until INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_suggestions_pending
      ON suggestions(agent_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_suggestions_dedup
      ON suggestions(agent_id, kind, payload_hash, created_at DESC);

    CREATE TABLE IF NOT EXISTS suggestion_mutes (
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      until INTEGER NOT NULL,
      PRIMARY KEY (agent_id, kind)
    );
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO suggestions (agent_id, kind, payload, payload_hash, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `),
    get: db.prepare<[number], SuggestionRow>(`SELECT * FROM suggestions WHERE id = ?`),
    lastForDedup: db.prepare<[string, string, string], SuggestionRow>(`
      SELECT * FROM suggestions
      WHERE agent_id = ? AND kind = ? AND payload_hash = ? AND status != 'expired'
      ORDER BY created_at DESC LIMIT 1
    `),
    countSurfacedSince: db.prepare<[string, number], { n: number }>(`
      SELECT COUNT(*) AS n FROM suggestions WHERE agent_id = ? AND created_at >= ?
    `),
    countPrioritySince: db.prepare<[string, number, number], { n: number }>(`
      SELECT COUNT(*) AS n FROM suggestions
      WHERE agent_id = ? AND created_at >= ? AND confidence >= ?
    `),
    setStatus: db.prepare(`
      UPDATE suggestions SET status = ?, acted_on_at = ? WHERE id = ?
    `),
    getMute: db.prepare<[string, string], { until: number }>(`
      SELECT until FROM suggestion_mutes WHERE agent_id = ? AND kind = ?
    `),
    upsertMute: db.prepare(`
      INSERT INTO suggestion_mutes (agent_id, kind, until) VALUES (?, ?, ?)
      ON CONFLICT(agent_id, kind) DO UPDATE SET until = excluded.until
    `),
  };

  function rowToSuggestion(r: SuggestionRow): Suggestion {
    return {
      id: r.id,
      agentId: r.agent_id,
      kind: r.kind as SuggestionKind,
      payload: safeParse(r.payload),
      payloadHash: r.payload_hash,
      confidence: r.confidence,
      status: r.status as SuggestionStatus,
      createdAt: r.created_at,
      actedOnAt: r.acted_on_at,
      mutedUntil: r.muted_until,
    };
  }

  function isMuted(agentId: string, kind: string, at: number): boolean {
    const m = stmts.getMute.get(agentId, kind);
    return !!m && m.until > at;
  }

  return {
    /**
     * Surface a suggestion to an agent — unless a damper suppresses it. Returns
     * `{created:false, reason}` for cooldown/budget/mute so the broker can log
     * the suppression for tuning (ADR-0039 §Risks #1) instead of dropping it.
     */
    create(input: CreateSuggestionInput): CreateSuggestionResult {
      const at = now();
      const payloadHash = input.payloadHash ?? hashPayload(input.kind, input.payload);
      const confidence = input.confidence ?? policy.defaultConfidence;

      if (isMuted(input.agentId, input.kind, at)) {
        return { created: false, reason: 'muted' };
      }

      // `lastForDedup` excludes status='expired': an overlap that aged out unacted
      // should be re-surfaceable, so an expired row must not keep anchoring the
      // cooldown. A *declined* row still anchors (that's the intended mute).
      const last = stmts.lastForDedup.get(input.agentId, input.kind, payloadHash);
      if (last) {
        // Anchor the cooldown to the most recent activity on the tuple: a decline
        // re-arms the window from the decline time (ADR-0039 — "declining mutes the
        // exact triplet for that window"), not merely from when it was first surfaced.
        const lastActivity = Math.max(last.created_at, last.acted_on_at ?? 0);
        if (at - lastActivity < policy.cooldownMs) {
          return { created: false, reason: 'cooldown', existingId: last.id };
        }
      }

      const windowStart = at - 60 * 60 * 1000;
      if (confidence >= policy.priorityConfidence) {
        // PRIORITY: bypass the normal cap (so trivial-overlap floods can't starve a
        // critical one — S5), but enforce a separate higher ceiling so a flood of
        // self-declared "critical" still can't spam without bound.
        const { n } = stmts.countPrioritySince.get(input.agentId, windowStart, policy.priorityConfidence)!;
        if (n >= policy.priorityHourlyBudget) {
          return { created: false, reason: 'budget' };
        }
      } else {
        const { n } = stmts.countSurfacedSince.get(input.agentId, windowStart)!;
        if (n >= policy.hourlyBudget) {
          return { created: false, reason: 'budget' };
        }
      }

      const payloadStr =
        typeof input.payload === 'string' ? input.payload : JSON.stringify(input.payload ?? null);
      const res = stmts.insert.run(
        input.agentId,
        input.kind,
        payloadStr,
        payloadHash,
        confidence,
        at,
      );
      const suggestion = rowToSuggestion(stmts.get.get(Number(res.lastInsertRowid))!);
      return { created: true, suggestion };
    },

    get(id: number): Suggestion | null {
      const r = stmts.get.get(id);
      return r ? rowToSuggestion(r) : null;
    },

    list(options: { agentId?: string; status?: SuggestionStatus; limit?: number } = {}): Suggestion[] {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (options.agentId) {
        clauses.push('agent_id = ?');
        params.push(options.agentId);
      }
      if (options.status) {
        clauses.push('status = ?');
        params.push(options.status);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(options.limit ?? 100, 1000));
      const rows = db
        .prepare(`SELECT * FROM suggestions ${where} ORDER BY created_at DESC LIMIT ?`)
        .all(...params, limit) as SuggestionRow[];
      return rows.map(rowToSuggestion);
    },

    /** Agent acted on the suggestion (created the channel, pinged the other holder, etc.). */
    accept(id: number): { success: boolean; suggestion?: Suggestion; error?: string } {
      const r = stmts.get.get(id);
      if (!r) return { success: false, error: 'not found' };
      if (r.status !== 'pending') return { success: false, error: `already ${r.status}` };
      stmts.setStatus.run('accepted', now(), id);
      return { success: true, suggestion: rowToSuggestion(stmts.get.get(id)!) };
    },

    /** Agent declined — primes the cooldown so the same fact stays quiet for the window. */
    decline(id: number): { success: boolean; suggestion?: Suggestion; error?: string } {
      const r = stmts.get.get(id);
      if (!r) return { success: false, error: 'not found' };
      if (r.status !== 'pending') return { success: false, error: `already ${r.status}` };
      stmts.setStatus.run('declined', now(), id);
      return { success: true, suggestion: rowToSuggestion(stmts.get.get(id)!) };
    },

    /** Mute a whole kind for an agent until `untilMs` (absolute epoch ms). */
    mute(agentId: string, kind: SuggestionKind, untilMs: number): { success: boolean; until: number } {
      stmts.upsertMute.run(agentId, kind, untilMs);
      return { success: true, until: untilMs };
    },

    isMuted(agentId: string, kind: SuggestionKind): boolean {
      return isMuted(agentId, kind, now());
    },

    /** Move pending suggestions older than `maxAgeMs` to 'expired'. Returns count moved. */
    expireStale(maxAgeMs: number): number {
      const cutoff = now() - maxAgeMs;
      const res = db
        .prepare(`UPDATE suggestions SET status = 'expired', acted_on_at = ? WHERE status = 'pending' AND created_at < ?`)
        .run(now(), cutoff);
      return res.changes;
    },

    policy,
  };
}

export type Suggestions = ReturnType<typeof createSuggestions>;
