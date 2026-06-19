/**
 * Content-Addressed Blob Store
 *
 * Phase 0 of the tube-as-coordination-substrate roadmap. Provides a
 * filesystem-backed, content-addressed object store: callers `put` bytes,
 * receive a SHA-256 id, and can `get`/`stat`/`list`/`delete` by that id.
 *
 * No database required — blobs live as plain files under
 * `~/.port-daddy/blobs/<id>` (configurable). Optional sidecar `<id>.meta`
 * files persist Content-Type plus first-write timestamp. The store is
 * crash-safe: writes go through a `.tmp` sibling and are rename(2)-promoted,
 * and any orphan `.tmp` files left behind by a previous crash are reaped at
 * construction time.
 *
 * Design notes:
 * - Ids are 64-char lowercase hex (sha256). Anything else is rejected before
 *   touching the filesystem so a malicious `../etc/passwd` or `nul.byte` id
 *   can never escape the configured directory.
 * - `put` is idempotent: identical bytes always produce the same id, and the
 *   on-disk file is reused if it already exists.
 * - `gc()` is the housekeeping primitive — it never deletes blobs whose ids
 *   appear in the optional `keepIds` set, even if they are old.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { PD_HOME } from '../shared/paths.js';

const ID_REGEX = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50 MB — generous for tube payloads, still bounded.

export interface BlobStat {
  id: string;
  size: number;
  contentType?: string;
  createdAt: number;
}

export interface BlobRecord extends BlobStat {
  buffer: Buffer;
}

export interface PutOptions {
  contentType?: string;
}

export interface ListOptions {
  limit?: number;
  since?: number;
}

export interface GcOptions {
  olderThanMs?: number;
  keepIds?: Set<string>;
}

export interface BlobStore {
  put(data: Buffer | string, opts?: PutOptions): BlobStat;
  get(id: string): BlobRecord | null;
  has(id: string): boolean;
  stat(id: string): BlobStat | null;
  list(opts?: ListOptions): BlobStat[];
  delete(id: string): boolean;
  gc(opts?: GcOptions): { removed: number; kept: number };
  readonly dir: string;
  readonly maxBytes: number;
}

export interface CreateBlobStoreOptions {
  dir?: string;
  maxBytes?: number;
}

interface PersistedMeta {
  contentType?: string;
  createdAt?: number;
}

export function createBlobStore(opts: CreateBlobStoreOptions = {}): BlobStore {
  const dir = opts.dir ?? join(PD_HOME, 'blobs');
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Reap any leftover .tmp files from a previous crash. A real blob is only
  // visible after rename(2), so a stray .tmp is always recoverable garbage.
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.tmp')) {
      try {
        unlinkSync(join(dir, name));
      } catch {
        // Best-effort cleanup — ignore.
      }
    }
  }

  function pathFor(id: string): string {
    if (!ID_REGEX.test(id)) {
      throw new Error(`blob: invalid id (must be 64-char lowercase hex): ${id}`);
    }
    return join(dir, id);
  }

  function metaPathFor(id: string): string {
    return pathFor(id) + '.meta';
  }

  function readMeta(id: string): PersistedMeta | null {
    const mp = join(dir, id + '.meta');
    if (!existsSync(mp)) return null;
    try {
      const parsed = JSON.parse(readFileSync(mp, 'utf8')) as PersistedMeta;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function statById(id: string): BlobStat | null {
    if (!ID_REGEX.test(id)) return null;
    const p = join(dir, id);
    if (!existsSync(p)) return null;
    const st = statSync(p);
    const meta = readMeta(id);
    const createdAt = typeof meta?.createdAt === 'number'
      ? meta.createdAt
      : Math.floor((st as unknown as { birthtimeMs?: number }).birthtimeMs ?? st.mtimeMs);
    return {
      id,
      size: st.size,
      contentType: meta?.contentType,
      createdAt,
    };
  }

  function put(data: Buffer | string, putOpts: PutOptions = {}): BlobStat {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    if (buf.length > maxBytes) {
      const err = new Error(`blob: payload exceeds maxBytes (${buf.length} > ${maxBytes})`);
      (err as Error & { code?: string }).code = 'BLOB_TOO_LARGE';
      throw err;
    }

    const id = createHash('sha256').update(buf).digest('hex');
    const target = pathFor(id);
    const createdAt = Date.now();

    if (!existsSync(target)) {
      const tmp = target + '.tmp';
      writeFileSync(tmp, buf, { mode: 0o600 });
      renameSync(tmp, target);
      // Persist meta on first write only. Re-puts of the same content keep
      // the original Content-Type / createdAt.
      writeFileSync(
        metaPathFor(id),
        JSON.stringify({ contentType: putOpts.contentType, createdAt }),
        { mode: 0o600 },
      );
    }

    const stat = statById(id);
    if (!stat) {
      // statById should always succeed right after a successful write.
      throw new Error(`blob: stat failed immediately after put for id ${id}`);
    }
    return stat;
  }

  function has(id: string): boolean {
    if (!ID_REGEX.test(id)) return false;
    return existsSync(join(dir, id));
  }

  function get(id: string): BlobRecord | null {
    const s = statById(id);
    if (!s) return null;
    const buffer = readFileSync(pathFor(id));
    return { ...s, buffer };
  }

  function list(listOpts: ListOptions = {}): BlobStat[] {
    const limit = Math.max(1, Math.min(listOpts.limit ?? 100, 1000));
    const since = listOpts.since ?? 0;
    const out: BlobStat[] = [];
    for (const name of readdirSync(dir)) {
      if (!ID_REGEX.test(name)) continue;
      const s = statById(name);
      if (!s) continue;
      if (s.createdAt < since) continue;
      out.push(s);
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out.slice(0, limit);
  }

  function del(id: string): boolean {
    if (!ID_REGEX.test(id)) return false;
    const p = join(dir, id);
    if (!existsSync(p)) return false;
    unlinkSync(p);
    const mp = p + '.meta';
    if (existsSync(mp)) {
      try {
        unlinkSync(mp);
      } catch {
        // Meta is best-effort — the canonical record is the data file.
      }
    }
    return true;
  }

  function gc(gcOpts: GcOptions = {}): { removed: number; kept: number } {
    const cutoff = gcOpts.olderThanMs !== undefined ? Date.now() - gcOpts.olderThanMs : null;
    const keep = gcOpts.keepIds ?? new Set<string>();
    let removed = 0;
    let kept = 0;
    for (const name of readdirSync(dir)) {
      if (!ID_REGEX.test(name)) continue;
      if (keep.has(name)) {
        kept++;
        continue;
      }
      if (cutoff === null) {
        kept++;
        continue;
      }
      const s = statById(name);
      if (!s) continue;
      if (s.createdAt < cutoff) {
        del(name);
        removed++;
      } else {
        kept++;
      }
    }
    return { removed, kept };
  }

  return {
    put,
    get,
    has,
    stat: statById,
    list,
    delete: del,
    gc,
    dir,
    maxBytes,
  };
}
