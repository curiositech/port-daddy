/**
 * Booty — artifact harvest provenance over the content-addressed blob store.
 *
 * Slice S4a of the state-plane roadmap. Operator ruling: artifacts (design
 * workups, images, HTMLs, videos, shaders) are durable truth on ANY
 * plane/branch — never quarantined, always attributed.
 *
 * A booty row is NOT the artifact — the bytes live in the existing blob
 * store (lib/blob.ts, content-addressed by sha256). Booty is the provenance
 * ledger: which blob, harvested from which path, on which branch/worktree,
 * by which session/agent, optionally linked to a roadmap item.
 *
 * Dedupe contract: the same blob_hash on the same branch is idempotent —
 * re-depositing returns the existing row with `deduped: true`. The same
 * blob_hash on a DIFFERENT branch is a new row (the artifact is truth on
 * every plane it was harvested on).
 *
 * This slice is deposit + list only. No sweep hook, no gallery UI, no
 * promote — those are follow-ups.
 */

import { randomBytes } from 'node:crypto';
import { extname } from 'node:path';
import type { DatabaseInstance } from './sqlite-runtime.js';

const BLOB_HASH_REGEX = /^[0-9a-f]{64}$/;

export const DEFAULT_MEDIA_TYPE = 'application/octet-stream';

/**
 * Bounded extension → media type map. This is deliberately a structured
 * lookup over a field we control (file extensions), not free-text NLP.
 * Unknown extensions fall back to application/octet-stream.
 */
const MEDIA_TYPES: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  // Documents / markup
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml',
  // Scripts (harvested artifacts like generated demos)
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.gifv': 'video/mp4',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
};

/** Detect a media type from a file path's extension (bounded map). */
export function mediaTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  return MEDIA_TYPES[ext] ?? DEFAULT_MEDIA_TYPE;
}

export interface BootyRow {
  id: string;
  blob_hash: string;
  media_type: string;
  original_path: string;
  byte_size: number;
  branch: string;
  worktree: string | null;
  session_id: string | null;
  agent_identity: string | null;
  roadmap_link: string | null;
  note: string | null;
  created_at: number;
}

export interface BootyAddInput {
  blob_hash: string;
  media_type?: string | null;
  original_path: string;
  byte_size: number;
  branch: string;
  worktree?: string | null;
  session_id?: string | null;
  agent_identity?: string | null;
  roadmap_link?: string | null;
  note?: string | null;
}

export interface BootyListOptions {
  branch?: string;
  sessionId?: string;
  limit?: number;
}

export interface BootyStore {
  add(input: BootyAddInput): { row: BootyRow; deduped: boolean };
  list(opts?: BootyListOptions): BootyRow[];
}

export const BOOTY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS booty (
    id TEXT PRIMARY KEY,
    blob_hash TEXT NOT NULL,
    media_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    original_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    branch TEXT NOT NULL DEFAULT '',
    worktree TEXT,
    session_id TEXT,
    agent_identity TEXT,
    roadmap_link TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE(blob_hash, branch)
  );
  CREATE INDEX IF NOT EXISTS idx_booty_branch ON booty(branch, created_at);
  CREATE INDEX IF NOT EXISTS idx_booty_session ON booty(session_id, created_at);
`;

export function createBootyStore(db: DatabaseInstance): BootyStore {
  db.exec(BOOTY_SCHEMA_SQL);

  const insertStmt = db.prepare(`
    INSERT INTO booty (
      id, blob_hash, media_type, original_path, byte_size, branch,
      worktree, session_id, agent_identity, roadmap_link, note, created_at
    ) VALUES (
      @id, @blob_hash, @media_type, @original_path, @byte_size, @branch,
      @worktree, @session_id, @agent_identity, @roadmap_link, @note, @created_at
    )
    ON CONFLICT(blob_hash, branch) DO NOTHING
  `);
  const selectByHashBranch = db.prepare(
    'SELECT * FROM booty WHERE blob_hash = ? AND branch = ?',
  );

  function add(input: BootyAddInput): { row: BootyRow; deduped: boolean } {
    if (typeof input.blob_hash !== 'string' || !BLOB_HASH_REGEX.test(input.blob_hash)) {
      throw new Error(`booty: invalid blob_hash (must be 64-char lowercase hex): ${input.blob_hash}`);
    }
    if (typeof input.original_path !== 'string' || !input.original_path.trim()) {
      throw new Error('booty: original_path is required');
    }
    const byteSize = Number(input.byte_size);
    if (!Number.isFinite(byteSize) || byteSize < 0) {
      throw new Error('booty: byte_size must be a non-negative number');
    }
    // Branch is part of the dedupe key; normalize null/undefined to '' so
    // the UNIQUE constraint actually fires (SQLite treats NULLs as distinct).
    const branch = typeof input.branch === 'string' ? input.branch : '';

    const record = {
      id: `booty-${randomBytes(4).toString('hex')}`,
      blob_hash: input.blob_hash,
      media_type: input.media_type?.trim() || DEFAULT_MEDIA_TYPE,
      original_path: input.original_path,
      byte_size: Math.floor(byteSize),
      branch,
      worktree: input.worktree ?? null,
      session_id: input.session_id ?? null,
      agent_identity: input.agent_identity ?? null,
      roadmap_link: input.roadmap_link ?? null,
      note: input.note ?? null,
      created_at: Date.now(),
    };

    const result = insertStmt.run(record);
    const deduped = Number(result.changes) === 0;
    const row = selectByHashBranch.get(input.blob_hash, branch) as BootyRow | undefined;
    if (!row) {
      // Should be unreachable: either we just inserted, or the conflict row exists.
      throw new Error(`booty: row missing immediately after insert for ${input.blob_hash}@${branch}`);
    }
    return { row, deduped };
  }

  function list(opts: BootyListOptions = {}): BootyRow[] {
    // Respect an explicit limit of 0 (returns no rows); only fall back to the
    // default of 50 when limit is absent or not a finite number.
    const requested = Number(opts.limit);
    const limit =
      opts.limit === undefined || !Number.isFinite(requested)
        ? 50
        : Math.max(0, Math.min(Math.floor(requested), 500));
    const where: string[] = [];
    const params: unknown[] = [];
    if (typeof opts.branch === 'string' && opts.branch) {
      where.push('branch = ?');
      params.push(opts.branch);
    }
    if (typeof opts.sessionId === 'string' && opts.sessionId) {
      where.push('session_id = ?');
      params.push(opts.sessionId);
    }
    const sql = `
      SELECT * FROM booty
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    params.push(limit);
    return db.prepare(sql).all(...params) as BootyRow[];
  }

  return { add, list };
}
