/**
 * Roadmap Pop — atomic claim from the curated pile.
 *
 * Cartographer (ADR-0023) curates four piles of "what might be done next":
 * live feedback tuples, ROADMAP.md Next Cuts, IDEAS-TROVE.md `now`,
 * DOGFOOD-FEEDBACK.md. Until this module, the verb to *take* something
 * off those piles did not exist — operators eyeballed a slug and hoped
 * nobody else picked the same one.
 *
 * This module makes claim a first-class storage fact. The atomicity
 * boundary is a partial UNIQUE index on `roadmap_claims(slug)
 * WHERE released_at IS NULL` (see ADR-0033). Two callers racing on the
 * same slug result in one INSERT and one SQLITE_CONSTRAINT_UNIQUE;
 * we catch the latter and move to the next candidate.
 */

import type Database from 'better-sqlite3';
import { getRoadmapProgress, type RoadmapProgress } from './roadmap-progress.js';
import type { Feedback } from './feedback.js';

export type RoadmapPopKind = 'live' | 'next-cut' | 'now' | 'feedback';

export const ALL_KINDS: RoadmapPopKind[] = ['live', 'next-cut', 'now', 'feedback'];

export const DEFAULT_PRECEDENCE: RoadmapPopKind[] = ['live', 'next-cut', 'now', 'feedback'];

export interface RoadmapClaim {
  id: number;
  slug: string;
  kind: RoadmapPopKind;
  feedbackId: string | null;
  claimedBy: string;
  claimedAt: number;
  releasedAt: number | null;
  releasedBy: string | null;
  releaseReason: string | null;
  summary: string | null;
  surface: string | null;
  payload: Record<string, unknown> | null;
  /** Optional FK to sessions(id). Set when `pop --begin` chains, or via `linkClaim`. */
  sessionId: string | null;
  /** Optional FK to agents(id). Set alongside sessionId. */
  agentId: string | null;
}

export interface RoadmapEntry {
  slug: string;
  kind: RoadmapPopKind;
  summary: string;
  surface: string | null;
  feedbackId: string | null;
  payload: Record<string, unknown>;
}

export interface PopOptions {
  claimedBy: string;
  kind?: RoadmapPopKind | 'any';
  slug?: string;
  rootDir?: string;
  feedbackHarbor?: string;
  /** Optional session this claim opens. Populated when the CLI's --begin flag chains. */
  sessionId?: string;
  /** Optional agent that claims. When omitted, only `claimedBy` is recorded. */
  agentId?: string;
}

export interface LinkClaimOptions {
  slug?: string;
  claimId?: number;
  sessionId?: string;
  agentId?: string;
  /** Allow rebind even if the claim already has a session/agent. Default false. */
  force?: boolean;
}

export type LinkClaimResult =
  | { ok: true; claim: RoadmapClaim }
  | { ok: false; reason: 'no-active-claim' | 'already-linked'; claim: RoadmapClaim | null };

export interface PopResult {
  entry: RoadmapEntry;
  claim: RoadmapClaim;
}

export interface ReleaseOptions {
  slug: string;
  releasedBy: string;
  reason?: string;
}

export interface ListClaimsOptions {
  status?: 'open' | 'released' | 'all';
  claimedBy?: string;
  limit?: number;
}

export type RoadmapPopFailure =
  | { reason: 'pile-empty' }
  | { reason: 'slug-not-on-pile'; slug: string }
  | { reason: 'slug-already-claimed'; slug: string; claim: RoadmapClaim | null };

export interface RoadmapPopDeps {
  db: Database.Database;
  feedback?: Pick<Feedback, 'list' | 'summary'>;
  now?: () => number;
}

interface RoadmapClaimRow {
  id: number;
  slug: string;
  kind: string;
  feedback_id: string | null;
  claimed_by: string;
  claimed_at: number;
  released_at: number | null;
  released_by: string | null;
  release_reason: string | null;
  summary: string | null;
  surface: string | null;
  payload: string | null;
  session_id: string | null;
  agent_id: string | null;
}

function safeParsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    // Malformed payload (manual edit, partial write, future schema). The claim
    // row is still valid coordination state — surface it without the payload
    // rather than 500ing the entire listClaims/pop call.
    return null;
  }
}

function rowToClaim(row: RoadmapClaimRow): RoadmapClaim {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as RoadmapPopKind,
    feedbackId: row.feedback_id,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at,
    releasedAt: row.released_at,
    releasedBy: row.released_by,
    releaseReason: row.release_reason,
    summary: row.summary,
    surface: row.surface,
    payload: safeParsePayload(row.payload),
    sessionId: row.session_id ?? null,
    agentId: row.agent_id ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  return typeof e.message === 'string' && /UNIQUE constraint/i.test(e.message);
}

export function createRoadmapPop(deps: RoadmapPopDeps) {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());

  const runSchema = (sql: string) => db.exec(sql);

  runSchema(`
    CREATE TABLE IF NOT EXISTS roadmap_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      feedback_id TEXT,
      claimed_by TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      released_at INTEGER,
      released_by TEXT,
      release_reason TEXT,
      summary TEXT,
      surface TEXT,
      payload TEXT,
      session_id TEXT,
      agent_id TEXT
    )
  `);
  // ADR-0034: idempotent ALTER for databases that pre-date the session/agent columns.
  const existingCols = new Set(
    (db.prepare('PRAGMA table_info(roadmap_claims)').all() as { name: string }[]).map((c) => c.name),
  );
  if (!existingCols.has('session_id')) {
    runSchema('ALTER TABLE roadmap_claims ADD COLUMN session_id TEXT');
  }
  if (!existingCols.has('agent_id')) {
    runSchema('ALTER TABLE roadmap_claims ADD COLUMN agent_id TEXT');
  }
  runSchema(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_claims_active_slug
     ON roadmap_claims(slug) WHERE released_at IS NULL`,
  );
  runSchema(
    `CREATE INDEX IF NOT EXISTS idx_roadmap_claims_claimed_by
     ON roadmap_claims(claimed_by) WHERE released_at IS NULL`,
  );
  runSchema(
    `CREATE INDEX IF NOT EXISTS idx_roadmap_claims_session
     ON roadmap_claims(session_id) WHERE session_id IS NOT NULL`,
  );

  const insertStmt = db.prepare(`
    INSERT INTO roadmap_claims
      (slug, kind, feedback_id, claimed_by, claimed_at, summary, surface, payload, session_id, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const releaseStmt = db.prepare(`
    UPDATE roadmap_claims
       SET released_at = ?, released_by = ?, release_reason = ?
     WHERE slug = ? AND released_at IS NULL
  `);
  const findActiveBySlugStmt = db.prepare(
    'SELECT * FROM roadmap_claims WHERE slug = ? AND released_at IS NULL',
  );
  const findActiveByIdStmt = db.prepare(
    'SELECT * FROM roadmap_claims WHERE id = ? AND released_at IS NULL',
  );
  const findById = db.prepare('SELECT * FROM roadmap_claims WHERE id = ?');
  const linkStmt = db.prepare(`
    UPDATE roadmap_claims
       SET session_id = ?, agent_id = ?
     WHERE id = ? AND released_at IS NULL
  `);
  const findReleasedThisInstantStmt = db.prepare(
    'SELECT * FROM roadmap_claims WHERE slug = ? AND released_at = ? ORDER BY id DESC LIMIT 1',
  );

  function candidatesFromProgress(
    progress: RoadmapProgress,
    kind: RoadmapPopKind | 'any',
  ): RoadmapEntry[] {
    const out: RoadmapEntry[] = [];
    const kinds = kind === 'any' ? DEFAULT_PRECEDENCE : [kind];
    for (const k of kinds) {
      if (k === 'live') {
        for (const e of progress.liveFeedback) {
          out.push({
            slug: e.slug,
            kind: 'live',
            summary: e.summary ?? e.hook ?? e.slug,
            surface: e.surface ?? null,
            feedbackId: e.feedbackId ?? null,
            payload: { ...e },
          });
        }
      } else if (k === 'next-cut') {
        for (const c of progress.nextCuts) {
          out.push({
            slug: c.slug,
            kind: 'next-cut',
            summary: c.summary,
            surface: null,
            feedbackId: null,
            payload: { ...c },
          });
        }
      } else if (k === 'now') {
        for (const e of progress.ideasNow) {
          out.push({
            slug: e.slug,
            kind: 'now',
            summary: e.summary ?? e.hook ?? e.slug,
            surface: e.surface ?? null,
            feedbackId: e.feedbackId ?? null,
            payload: { ...e },
          });
        }
      } else if (k === 'feedback') {
        for (const e of progress.dogfoodFeedback) {
          out.push({
            slug: e.slug,
            kind: 'feedback',
            summary: e.summary ?? e.hook ?? e.slug,
            surface: e.surface ?? null,
            feedbackId: e.feedbackId ?? null,
            payload: { ...e },
          });
        }
      }
    }
    return out;
  }

  function attemptInsert(
    cand: RoadmapEntry,
    claimedBy: string,
    sessionId: string | null,
    agentId: string | null,
  ): RoadmapClaim | 'taken' {
    const at = now();
    try {
      const result = insertStmt.run(
        cand.slug,
        cand.kind,
        cand.feedbackId,
        claimedBy,
        at,
        cand.summary,
        cand.surface,
        JSON.stringify(cand.payload),
        sessionId,
        agentId,
      );
      return {
        id: Number(result.lastInsertRowid),
        slug: cand.slug,
        kind: cand.kind,
        feedbackId: cand.feedbackId,
        claimedBy,
        claimedAt: at,
        releasedAt: null,
        releasedBy: null,
        releaseReason: null,
        summary: cand.summary,
        surface: cand.surface,
        payload: cand.payload,
        sessionId,
        agentId,
      };
    } catch (err) {
      if (isUniqueViolation(err)) return 'taken';
      throw err;
    }
  }

  function pop(options: PopOptions): PopResult | RoadmapPopFailure {
    const claimedBy = options.claimedBy?.trim();
    if (!claimedBy) throw new Error('roadmap-pop: claimedBy is required');
    const kind = options.kind ?? 'any';
    const sessionId = options.sessionId?.trim() || null;
    const agentId = options.agentId?.trim() || null;

    const progress = getRoadmapProgress({
      rootDir: options.rootDir,
      feedback: deps.feedback,
      feedbackHarbor: options.feedbackHarbor,
    });

    let candidates = candidatesFromProgress(progress, kind);

    if (options.slug) {
      const targeted = candidates.filter((c) => c.slug === options.slug);
      if (targeted.length === 0) {
        return { reason: 'slug-not-on-pile', slug: options.slug };
      }
      candidates = targeted;
    }

    for (const cand of candidates) {
      const result = attemptInsert(cand, claimedBy, sessionId, agentId);
      if (result === 'taken') {
        if (options.slug) {
          // Race window: the conflicting row could be released between the
          // failed INSERT and this SELECT. Surface `claim: null` rather than
          // synthesizing an empty RoadmapClaim that lies about its shape.
          const existing = findActiveBySlugStmt.get(cand.slug) as RoadmapClaimRow | undefined;
          return {
            reason: 'slug-already-claimed',
            slug: cand.slug,
            claim: existing ? rowToClaim(existing) : null,
          };
        }
        continue;
      }
      return { entry: cand, claim: result };
    }

    return { reason: 'pile-empty' };
  }

  function release(options: ReleaseOptions): { released: boolean; claim: RoadmapClaim | null } {
    const slug = options.slug?.trim();
    const releasedBy = options.releasedBy?.trim();
    if (!slug) throw new Error('roadmap-pop: slug is required');
    if (!releasedBy) throw new Error('roadmap-pop: releasedBy is required');
    const at = now();
    const result = releaseStmt.run(at, releasedBy, options.reason ?? null, slug);
    if (result.changes === 0) return { released: false, claim: null };
    const row = findReleasedThisInstantStmt.get(slug, at) as RoadmapClaimRow | undefined;
    return { released: true, claim: row ? rowToClaim(row) : null };
  }

  function listClaims(options: ListClaimsOptions = {}): RoadmapClaim[] {
    const status = options.status ?? 'open';
    const limit = options.limit ?? 100;
    const where: string[] = [];
    const params: unknown[] = [];
    if (status === 'open') where.push('released_at IS NULL');
    else if (status === 'released') where.push('released_at IS NOT NULL');
    if (options.claimedBy) {
      where.push('claimed_by = ?');
      params.push(options.claimedBy);
    }
    let sql = 'SELECT * FROM roadmap_claims';
    if (where.length > 0) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY claimed_at DESC LIMIT ?';
    params.push(limit);
    const rows = db.prepare(sql).all(...params) as RoadmapClaimRow[];
    return rows.map(rowToClaim);
  }

  function getActiveClaim(slug: string): RoadmapClaim | null {
    const row = findActiveBySlugStmt.get(slug) as RoadmapClaimRow | undefined;
    return row ? rowToClaim(row) : null;
  }

  /**
   * Link an existing claim to a session and/or agent (ADR-0034). Used by
   * `pop --begin` after `pd begin` returns the session+agent IDs, and by
   * the manual `pd roadmap claim-link` rebind verb.
   *
   * Idempotent when both fields match what's already on the row.
   * Refuses to overwrite a different session/agent unless `force: true`.
   * Returns `reason: 'no-active-claim'` if the claim doesn't exist or is
   * already released.
   */
  function linkClaim(options: LinkClaimOptions): LinkClaimResult {
    const sessionId = options.sessionId?.trim() || null;
    const agentId = options.agentId?.trim() || null;
    if (!sessionId && !agentId) {
      throw new Error('roadmap-pop.linkClaim: at least one of sessionId/agentId required');
    }

    let row: RoadmapClaimRow | undefined;
    if (typeof options.claimId === 'number') {
      row = findActiveByIdStmt.get(options.claimId) as RoadmapClaimRow | undefined;
    } else if (options.slug) {
      row = findActiveBySlugStmt.get(options.slug.trim()) as RoadmapClaimRow | undefined;
    } else {
      throw new Error('roadmap-pop.linkClaim: claimId or slug required');
    }

    if (!row) return { ok: false, reason: 'no-active-claim', claim: null };

    const sameSession = row.session_id === sessionId || (sessionId === null && row.session_id !== null);
    const sameAgent = row.agent_id === agentId || (agentId === null && row.agent_id !== null);
    const alreadyLinked = row.session_id !== null || row.agent_id !== null;
    const requestMatchesExisting = row.session_id === sessionId && row.agent_id === agentId;

    if (alreadyLinked && !requestMatchesExisting && !options.force) {
      return { ok: false, reason: 'already-linked', claim: rowToClaim(row) };
    }

    if (requestMatchesExisting) {
      return { ok: true, claim: rowToClaim(row) };
    }

    // Suppress unused-var warnings; the same* booleans are kept as
    // documentation of the conditions feeding the decision above.
    void sameSession;
    void sameAgent;

    linkStmt.run(sessionId, agentId, row.id);
    const updated = findById.get(row.id) as RoadmapClaimRow;
    return { ok: true, claim: rowToClaim(updated) };
  }

  function getClaimBySession(sessionId: string): RoadmapClaim | null {
    const row = db
      .prepare('SELECT * FROM roadmap_claims WHERE session_id = ? AND released_at IS NULL ORDER BY claimed_at DESC LIMIT 1')
      .get(sessionId) as RoadmapClaimRow | undefined;
    return row ? rowToClaim(row) : null;
  }

  return { pop, release, listClaims, getActiveClaim, linkClaim, getClaimBySession };
}

export type RoadmapPop = ReturnType<typeof createRoadmapPop>;
