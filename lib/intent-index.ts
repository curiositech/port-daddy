/**
 * Intent Index — semantic search over session PURPOSES, alive and dead.
 *
 * Plan W2.1 (More Squid / suggestibility substrate): `pd begin` captures what
 * an agent intends to do (`sessions.purpose`), but until this module the only
 * search over that intent was LIKE-substring. The intent index embeds every
 * session purpose via the shared MiniLM embedder and answers "who has ever
 * tried to do something like THIS?" — deliberately including dead, completed,
 * and ancient sessions, because prior work is exactly what a fresh agent needs
 * pointed at (salvage briefings, W2.2).
 *
 * Doctrine (derived-index-consent-boundary + disposable-derivative):
 * `session_purpose_embeddings` is a DISPOSABLE DERIVATIVE of `sessions.purpose`.
 * It is safe to DROP at any time; `backfill()` rebuilds it. It is never an
 * authorization or identity surface. Writer rule: lib/intent-index.ts is the
 * ONLY writer of this table. Readers: intent-index search and the sugar
 * welcome briefing (via this API, not raw SQL). This module reads `sessions`
 * and `resurrection_queue` strictly read-only; their writers remain
 * lib/sessions.ts and lib/resurrection.ts.
 *
 * Relationship to whois (lib/whois.ts): whois routes NEW work to LIVE agents,
 * so it enforces a 7-day heartbeat freshness gate. The intent index is the
 * inverse — it finds PRIOR work, so there is deliberately NO freshness gate
 * anywhere in this module.
 */

import type Database from 'better-sqlite3';
import type { SemanticResolver } from './semantic-resolver.js';
import { CircuitOpenError } from './agent-resilience.js';
import { vectorToBlob, blobToVector, dotF32 } from './embedding-blob.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Similarity floor for salvage matching. Below this, MiniLM cosine between two
 * short purpose strings is topic noise, not "same work". Tuned from LIVE
 * embedder measurements (2026-08-04, Xenova/all-MiniLM-L6-v2), not folklore:
 * keyword-disjoint same-work paraphrases score 0.34-0.59 ("fix the login
 * authentication bug" vs "repair broken sign-in flow" = 0.44; "salvage
 * briefing at intake UX" vs "stitch wreck-recovery welcome screen" = 0.35)
 * while unrelated purposes score <= 0.10 ("…login…" vs "update readme
 * documentation" = 0.05). The spec's initial 0.45 guess rejected real matches;
 * 0.30 keeps every measured same-work pair with a 3x margin over noise.
 * Exported so tests and callers can override.
 */
export const DEFAULT_SALVAGE_MIN_SIMILARITY = 0.30;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IntentIndexDeps {
  /**
   * Embedding source — the shared MiniLM embedder behind the gated loader
   * (lib/semantic-resolver.ts). A broken ONNX runtime throws CircuitOpenError
   * fast instead of re-attempting the native load.
   */
  resolver: Pick<SemanticResolver, 'embed' | 'modelId'>;
  /** Optional structured logger. */
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

/** A session whose purpose semantically matched a query. */
export interface IntentHit {
  /** The matched session's id. */
  sessionId: string;
  /** The purpose text that was embedded and matched. */
  purpose: string;
  /** Cosine similarity (dot of normalized vectors) in [-1, 1]. */
  similarity: number;
  /** sessions.status verbatim ('active' | 'completed' | 'abandoned' | ...). */
  status: string;
  /** Convenience flag: status !== 'active'. Dead sessions are the point here. */
  isDead: boolean;
  /** Owning agent id when recorded. */
  agentId: string | null;
  /** Identity project scope when recorded. */
  identityProject: string | null;
  /** sessions.updated_at (ms epoch). */
  updatedAt: number;
  /** sessions.completed_at (ms epoch) or null while alive. */
  completedAt: number | null;
}

/** A dead-session salvage candidate enriched with resurrection-queue context. */
export interface SalvageMatch {
  /** The dead session's id. */
  sessionId: string;
  /** The purpose that matched. */
  purpose: string;
  /** Cosine similarity to the querying agent's purpose. */
  similarity: number;
  /** Always true for salvage matches (only dead sessions qualify). */
  isDead: boolean;
  /** sessions.status verbatim. */
  status: string;
  /**
   * sessions.updated_at / completed_at (ms epoch). Spec deviation, justified:
   * the briefing renders "(completed 30d ago)" for dormant matches that have
   * NO queue row (detectedAt is null there), so the session's own clock is
   * the only age source. Additive to the spec'd shape.
   */
  updatedAt: number;
  completedAt: number | null;
  /**
   * resurrection_queue.agent_id when a queue row exists — the id that
   * `pd salvage claim` / `pd salvage show` take. Null for dormant prior work
   * whose queue row was purged or never existed.
   */
  salvageAgentId: string | null;
  /** resurrection_queue.status ('pending' | 'stale' | ...) or null. */
  queueStatus: string | null;
  /** resurrection_queue.detected_at (ms epoch) or null. */
  detectedAt: number | null;
  /** True when the queue row carries a self-salvage capsule. */
  hasCapsule: boolean;
  /**
   * Truncated preview of the capsule. Capsule fields are ATTACKER-CONTROLLABLE
   * (the dying agent wrote them — lib/resurrection.ts:74-79); they are DISPLAY
   * CONTEXT ONLY and must never gate authorization.
   */
  capsulePreview: {
    telosVerdict?: string;
    doable?: string;
    whyStopped?: string;
    nextPlanHead?: string;
  } | null;
  /** `pd salvage show <salvageAgentId>` when a queue row exists, else null. */
  command: string | null;
}

export interface IntentIndex {
  indexSession(sessionId: string, purpose: string): Promise<{ indexed: boolean }>;
  backfill(opts?: { budget?: number; nowMs?: number }): Promise<{ embedded: number; scanned: number; exhausted: boolean }>;
  gc(): { deleted: number };
  search(query: string, opts?: { limit?: number; excludeSessionId?: string; minSimilarity?: number }): Promise<IntentHit[]>;
  searchSalvage(purpose: string, opts?: { limit?: number; minSimilarity?: number }): Promise<SalvageMatch[]>;
}

// ─── Row shapes ──────────────────────────────────────────────────────────────

interface CorpusRow {
  session_id: string;
  purpose: string;
  embedding: Buffer;
  status: string;
  agent_id: string | null;
  identity_project: string | null;
  updated_at: number;
  completed_at: number | null;
}

interface MissingRow {
  id: string;
  purpose: string;
}

interface QueueRow {
  agent_id: string;
  agent_name: string;
  status: string;
  detected_at: number;
  metadata: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Preview-string truncation cap: capsule text is untrusted and display-only. */
const PREVIEW_MAX = 200;

/**
 * Parse an integer env override, falling back on absence or garbage.
 *
 * Why env-tunable: the backfill budget is a live-ops dial (a huge history or a
 * slow machine may want a smaller sweep) and dials belong in env, not code.
 *
 * @param name - Environment variable name.
 * @param fallback - Value when unset or non-numeric.
 * @returns The parsed integer or the fallback.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Whitespace-normalize and hard-truncate an untrusted capsule string.
 *
 * Design rationale: capsule fields come from the dying agent (attacker-
 * controllable), so every preview string is clamped to PREVIEW_MAX before it
 * can reach a briefing or transcript — display context only, bounded size.
 *
 * @param value - Candidate preview value (non-strings are dropped).
 * @returns The truncated string, or undefined when not a usable string.
 */
function truncatePreview(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > PREVIEW_MAX ? normalized.slice(0, PREVIEW_MAX) : normalized;
}

/**
 * Detect the gated loader's circuit-open failure. Why the loose matching
 * (instanceof OR name OR code OR message): tests inject fake errors and
 * bundlers can duplicate classes, so identity alone is brittle — the design
 * intent is to never miss a circuit-open. Motivation: the 313GB-write-storm
 * lesson (semantic-resolver.ts
 * gated-loader comment): when the embedder is down, stop the whole sweep after
 * ONE detection — never log per-row.
 *
 * @param err - The caught error from resolver.embed().
 * @returns True when the error is (or looks like) the breaker's circuit-open.
 */
function isCircuitOpen(err: unknown): boolean {
  if (err instanceof CircuitOpenError) return true;
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; code?: unknown; message?: unknown };
    if (e.name === 'CircuitOpenError' || e.code === 'CIRCUIT_OPEN') return true;
    if (typeof e.message === 'string' && /circuit OPEN/i.test(e.message)) return true;
  }
  return false;
}

// ─── Module factory ──────────────────────────────────────────────────────────

/**
 * Create the intent index service — the single writer of the
 * `session_purpose_embeddings` sidecar.
 *
 * Design mirror: this follows the whois sidecar pattern (lib/whois.ts:282-331)
 * — idempotent DDL in the factory, prepared statements, an injected resolver so
 * tests run without the native ONNX runtime — because that pattern already
 * survived production (the gated-loader hardening, the disposable-derivative
 * doctrine). The one intentional divergence is the ABSENCE of any freshness
 * gate: whois routes work to live agents; this index surfaces prior work, so
 * dead and ancient sessions must rank.
 *
 * @param db - The canonical daemon SQLite handle (single-writer topology).
 * @param deps - Resolver (shared MiniLM embedder) and optional logger.
 * @returns The IntentIndex API: indexSession, backfill, gc, search, searchSalvage.
 */
export function createIntentIndex(db: Database.Database, deps: IntentIndexDeps): IntentIndex {
  const { resolver, logger } = deps;

  // DOCTRINE: session_purpose_embeddings is a DISPOSABLE DERIVATIVE of
  // sessions.purpose. Safe to DROP at any time; backfill() rebuilds it. It is
  // never an authorization or identity surface. Writer rule:
  // lib/intent-index.ts is the ONLY writer. Readers: intent-index search and
  // the sugar welcome briefing (via the API, not raw SQL). `sessions` and
  // `resurrection_queue` are read here strictly read-only; their writers stay
  // lib/sessions.ts and lib/resurrection.ts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_purpose_embeddings (
      session_id TEXT PRIMARY KEY,      -- FK-by-convention to sessions.id (no FK constraint; sidecar is disposable)
      purpose    TEXT NOT NULL,         -- the exact text embedded; drift detector for re-embedding
      model      TEXT NOT NULL,         -- resolver.modelId; model swap invalidates rows (disposable-derivative doctrine)
      embedding  BLOB NOT NULL,         -- Float32Array via vectorToBlob
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spe_model ON session_purpose_embeddings(model);
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO session_purpose_embeddings (session_id, purpose, model, embedding, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        purpose = excluded.purpose,
        model = excluded.model,
        embedding = excluded.embedding,
        created_at = excluded.created_at
    `),
    listCorpus: db.prepare(`
      SELECT e.session_id, e.purpose, e.embedding,
             s.status, s.agent_id, s.identity_project, s.updated_at, s.completed_at
      FROM session_purpose_embeddings e
      JOIN sessions s ON s.id = e.session_id
      WHERE e.model = ?
    `),
    // Covers alive AND dead sessions; catches purpose drift and model swap;
    // newest-first so recent salvage is indexed before ancient history when
    // the budget runs out mid-sweep.
    listMissing: db.prepare(`
      SELECT s.id, s.purpose
      FROM sessions s
      LEFT JOIN session_purpose_embeddings e ON e.session_id = s.id
      WHERE (e.session_id IS NULL OR e.purpose != s.purpose OR e.model != ?)
      ORDER BY s.updated_at DESC
      LIMIT ?
    `),
    // Delete-propagation: a deleted session deletes its derived row.
    gcOrphans: db.prepare(`
      DELETE FROM session_purpose_embeddings
      WHERE session_id NOT IN (SELECT id FROM sessions)
    `),
    gcModel: db.prepare(`
      DELETE FROM session_purpose_embeddings WHERE model != ?
    `),
    queueBySession: db.prepare(`
      SELECT agent_id, agent_name, status, detected_at, metadata
      FROM resurrection_queue
      WHERE session_id = ?
      LIMIT 1
    `),
  };

  /**
   * Embed and upsert one session's purpose into the sidecar.
   *
   * Design intent: this rides the `pd begin` fast-path fire-and-forget (the
   * first call after daemon start may trigger the multi-second ONNX model
   * load), so it NEVER throws — every failure degrades to `{indexed:false}`
   * with one governed error log. A failed index is invisible to the agent and
   * repaired by the next backfill sweep.
   *
   * @param sessionId - The session whose purpose to index.
   * @param purpose - The purpose text (trimmed; empty → indexed:false).
   * @returns Whether a row was written.
   */
  async function indexSession(sessionId: string, purpose: string): Promise<{ indexed: boolean }> {
    try {
      const trimmed = typeof purpose === 'string' ? purpose.trim() : '';
      if (!sessionId || !trimmed) return { indexed: false };
      const vector = await resolver.embed(trimmed);
      if (!vector.length) return { indexed: false };
      stmts.upsert.run(sessionId, trimmed, resolver.modelId, vectorToBlob(vector), Date.now());
      return { indexed: true };
    } catch (err) {
      logger?.error?.('intent_index_embed_failed', {
        sessionId,
        error: (err as Error).message,
      });
      return { indexed: false };
    }
  }

  /**
   * Budgeted convergence sweep: embed every session whose purpose is missing
   * from the sidecar, drifted from the stored text, or embedded under a
   * different model.
   *
   * Why budgeted and newest-first: the sweep runs on daemon start and on the
   * periodic cleanup tick; a bounded batch keeps a large history from stalling
   * the tick, and newest-first means the sessions an agent is most likely to
   * be pointed at (recent salvage) are indexed before ancient history.
   * Idempotent — safe on every daemon start (whois.backfill doctrine).
   *
   * Circuit discipline: when the embedder's gated loader is OPEN, the whole
   * sweep aborts after the FIRST circuit-open error with a single info line —
   * per-row error logging against a down embedder is the exact shape of the
   * 313GB write storm this repo already paid for.
   *
   * @param opts - budget (rows per sweep; env PD_INTENT_BACKFILL_BUDGET,
   *   default 300, clamped 1..5000) and nowMs (test clock for created_at).
   * @returns embedded/scanned counts and whether the budget was exhausted
   *   (caller may schedule another pass).
   */
  async function backfill(
    opts: { budget?: number; nowMs?: number } = {},
  ): Promise<{ embedded: number; scanned: number; exhausted: boolean }> {
    const rawBudget = opts.budget ?? envInt('PD_INTENT_BACKFILL_BUDGET', 300);
    const budget = Math.min(Math.max(Math.floor(rawBudget), 1), 5000);
    const nowMs = opts.nowMs ?? Date.now();

    let rows: MissingRow[];
    try {
      rows = stmts.listMissing.all(resolver.modelId, budget) as MissingRow[];
    } catch (err) {
      logger?.error?.('intent_backfill_scan_failed', { error: (err as Error).message });
      return { embedded: 0, scanned: 0, exhausted: false };
    }

    let embedded = 0;
    let scanned = 0;
    for (const row of rows) {
      scanned++;
      try {
        const trimmed = typeof row.purpose === 'string' ? row.purpose.trim() : '';
        if (!trimmed) continue;
        const vector = await resolver.embed(trimmed);
        if (!vector.length) continue;
        stmts.upsert.run(row.id, trimmed, resolver.modelId, vectorToBlob(vector), nowMs);
        embedded++;
      } catch (err) {
        if (isCircuitOpen(err)) {
          // Embedder is down: abort the sweep with ONE line, no per-row spam.
          logger?.info?.('intent_backfill_embedder_unavailable', {
            scanned,
            embedded,
          });
          return { embedded, scanned, exhausted: false };
        }
        logger?.error?.('intent_backfill_row_failed', {
          sessionId: row.id,
          error: (err as Error).message,
        });
      }
    }
    return { embedded, scanned, exhausted: scanned === budget };
  }

  /**
   * Converge the derivative toward its source: drop rows for deleted sessions
   * (delete-propagation) and rows embedded under a different model
   * (model-swap invalidation).
   *
   * Why synchronous and embedder-free: gc is correctness-of-the-derivative
   * maintenance, distinct from the size-ceiling retention policy registered in
   * lib/observability/maintenance.ts. It must run cheaply on every cleanup
   * tick even when the embedder is down.
   *
   * @returns Total rows deleted across both passes.
   */
  function gc(): { deleted: number } {
    const orphans = stmts.gcOrphans.run().changes;
    const wrongModel = stmts.gcModel.run(resolver.modelId).changes;
    return { deleted: orphans + wrongModel };
  }

  /**
   * Semantic nearest-neighbor search over ALL indexed session purposes.
   *
   * @param query - Free-text intent to match against session purposes.
   * @param opts - limit (1..50, default 10), excludeSessionId (drop the
   *   caller's own session), minSimilarity (cosine floor, default 0).
   * @returns Hits sorted by similarity desc; [] on empty query/corpus or
   *   embedder failure (search never throws — degrade to empty).
   */
  async function search(
    query: string,
    opts: { limit?: number; excludeSessionId?: string; minSimilarity?: number } = {},
  ): Promise<IntentHit[]> {
    const trimmed = typeof query === 'string' ? query.trim() : '';
    if (!trimmed) return [];
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const minSimilarity = opts.minSimilarity ?? 0;

    let queryVec: number[];
    try {
      queryVec = await resolver.embed(trimmed);
    } catch (err) {
      if (!isCircuitOpen(err)) {
        logger?.error?.('intent_search_embed_failed', { error: (err as Error).message });
      }
      return [];
    }
    if (!queryVec.length) return [];

    const corpus = stmts.listCorpus.all(resolver.modelId) as CorpusRow[];
    if (corpus.length === 0) return [];

    // Deliberately NO freshness gate. This is the inverse of whois
    // (lib/whois.ts:219-235): whois routes work to live agents so it excludes
    // >7d heartbeats; the intent index finds PRIOR work so dead and ancient
    // sessions are the point (plan W2.1).
    const hits: IntentHit[] = [];
    for (const row of corpus) {
      if (opts.excludeSessionId && row.session_id === opts.excludeSessionId) continue;
      const similarity = dotF32(queryVec, blobToVector(row.embedding));
      if (similarity < minSimilarity) continue;
      hits.push({
        sessionId: row.session_id,
        purpose: row.purpose,
        similarity,
        status: row.status,
        isDead: row.status !== 'active',
        agentId: row.agent_id,
        identityProject: row.identity_project,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
      });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    return hits.slice(0, limit);
  }

  /**
   * Salvage-oriented search: dead sessions whose purpose matches the given
   * one, enriched with resurrection-queue context (claimable agent id, queue
   * status, self-salvage capsule preview).
   *
   * Why matches WITHOUT a queue row are still returned: resurrection.cleanup()
   * purges queue rows after ~7 days, but the dead SESSION and its embedding
   * survive — that dormant prior work is still exactly what a new agent should
   * see, labeled honestly as context-only (no claimable capsule). Ranking:
   * queue-row-bearing matches first (claimable beats merely-dormant), then
   * similarity.
   *
   * Security posture: capsule fields are ATTACKER-CONTROLLABLE (written by the
   * dying agent — lib/resurrection.ts:74-79); they are DISPLAY CONTEXT ONLY.
   * Every preview string is truncated; metadata JSON is parsed defensively and
   * never throws (mirrors resurrection.ts parseMetadata).
   *
   * @param purpose - The new agent's declared purpose to match against.
   * @param opts - limit (default 3) and minSimilarity (default
   *   DEFAULT_SALVAGE_MIN_SIMILARITY).
   * @returns Ranked salvage matches; [] when nothing clears the floor.
   */
  async function searchSalvage(
    purpose: string,
    opts: { limit?: number; minSimilarity?: number } = {},
  ): Promise<SalvageMatch[]> {
    const hits = await search(purpose, {
      limit: 15,
      minSimilarity: opts.minSimilarity ?? DEFAULT_SALVAGE_MIN_SIMILARITY,
    });

    const matches: SalvageMatch[] = [];
    for (const hit of hits) {
      if (!hit.isDead) continue;

      let queueRow: QueueRow | undefined;
      try {
        queueRow = stmts.queueBySession.get(hit.sessionId) as QueueRow | undefined;
      } catch {
        queueRow = undefined;
      }

      let hasCapsule = false;
      let capsulePreview: SalvageMatch['capsulePreview'] = null;
      if (queueRow?.metadata) {
        // Defensive parse — corrupt/forged metadata must never make the
        // briefing throw (mirror of resurrection.ts parseMetadata).
        try {
          const parsed: unknown = JSON.parse(queueRow.metadata);
          const capsule = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>).salvageCapsule
            : undefined;
          if (capsule && typeof capsule === 'object' && !Array.isArray(capsule)) {
            hasCapsule = true;
            const c = capsule as Record<string, unknown>;
            const nextPlan = Array.isArray(c.nextPlan) ? c.nextPlan : [];
            const nextPlanHead = nextPlan.find((item): item is string => typeof item === 'string');
            capsulePreview = {
              telosVerdict: truncatePreview(c.telosVerdict),
              doable: truncatePreview(c.doable),
              whyStopped: truncatePreview(c.whyStopped),
              nextPlanHead: truncatePreview(nextPlanHead),
            };
          }
        } catch {
          // Corrupt metadata: degrade to no capsule, keep the match.
        }
      }

      matches.push({
        sessionId: hit.sessionId,
        purpose: hit.purpose,
        similarity: hit.similarity,
        isDead: true,
        status: hit.status,
        updatedAt: hit.updatedAt,
        completedAt: hit.completedAt,
        salvageAgentId: queueRow?.agent_id ?? null,
        queueStatus: queueRow?.status ?? null,
        detectedAt: queueRow?.detected_at ?? null,
        hasCapsule,
        capsulePreview,
        command: queueRow?.agent_id ? `pd salvage show ${queueRow.agent_id}` : null,
      });
    }

    // Claimable (queue-row-bearing) beats merely-dormant; similarity breaks ties.
    matches.sort((a, b) => {
      const aq = a.salvageAgentId ? 1 : 0;
      const bq = b.salvageAgentId ? 1 : 0;
      if (aq !== bq) return bq - aq;
      return b.similarity - a.similarity;
    });

    return matches.slice(0, Math.min(Math.max(opts.limit ?? 3, 1), 50));
  }

  return { indexSession, backfill, gc, search, searchSalvage };
}

export type IntentIndexService = ReturnType<typeof createIntentIndex>;
