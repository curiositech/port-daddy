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
}

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

  db.exec(`
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
      payload TEXT
    )
  `);
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_claims_active_slug
     ON roadmap_claims(slug) WHERE released_at IS NULL`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_roadmap_claims_claimed_by
     ON roadmap_claims(claimed_by) WHERE released_at IS NULL`,
  );

  const insertStmt = db.prepare(`
    INSERT INTO roadmap_claims
      (slug, kind, feedback_id, claimed_by, claimed_at, summary, surface, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const releaseStmt = db.prepare(`
    UPDATE roadmap_claims
       SET released_at = ?, released_by = ?, release_reason = ?
     WHERE slug = ? AND released_at IS NULL
  `);
  const findActiveBySlugStmt = db.prepare(
    'SELECT * FROM roadmap_claims WHERE slug = ? AND released_at IS NULL',
  );
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

  function attemptInsert(cand: RoadmapEntry, claimedBy: string): RoadmapClaim | 'taken' {
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
      const result = attemptInsert(cand, claimedBy);
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

  return { pop, release, listClaims, getActiveClaim };
}

export type RoadmapPop = ReturnType<typeof createRoadmapPop>;
