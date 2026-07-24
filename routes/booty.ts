/**
 * Booty Routes — artifact harvest provenance HTTP surface (slice S4a).
 *
 *   GET  /booty  — list provenance rows (?branch=, ?session=, ?limit=)
 *   POST /booty  — deposit a provenance row for an already-stored blob
 *
 * The artifact bytes themselves travel through the existing blob store
 * surface (POST /blob, routes/blob.ts). POST /booty only records
 * provenance and therefore requires the referenced blob to already exist —
 * a booty row must never point at bytes the store cannot produce.
 *
 * Error contract (matches routes/blob.ts conventions):
 *   400 — malformed blob_hash / missing original_path
 *   404 — blob_hash not present in the blob store
 *   201 — new provenance row; 200 — idempotent re-deposit (deduped: true)
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { BootyStore } from '../lib/booty.js';

interface BootyRouteDeps {
  booty: BootyStore;
  blobs: {
    has(id: string): boolean;
    stat(id: string): { size: number; contentType?: string } | null;
  };
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

const BLOB_HASH_REGEX = /^[0-9a-f]{64}$/;

export const bootyPlugin: FastifyPluginAsync<{ deps: BootyRouteDeps }> = async (fastify, opts) => {
  const { booty, blobs, logger } = opts.deps;

  // POST /booty — deposit provenance for an already-stored blob
  fastify.post('/booty', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const blobHash = typeof body.blob_hash === 'string' ? body.blob_hash : '';

    if (!BLOB_HASH_REGEX.test(blobHash)) {
      reply.code(400);
      return { success: false, error: 'blob_hash must be 64-char lowercase hex' };
    }
    if (typeof body.original_path !== 'string' || !body.original_path.trim()) {
      reply.code(400);
      return { success: false, error: 'original_path is required' };
    }
    // The blob store is authoritative for size and content type — never trust
    // client-supplied byte_size/media_type for a blob the store can describe.
    const stat = blobs.has(blobHash) ? blobs.stat(blobHash) : null;
    if (!stat) {
      reply.code(404);
      return { success: false, error: 'blob not found in store — POST /blob first' };
    }

    const byteSize = stat.size;
    const mediaType =
      stat.contentType || (typeof body.media_type === 'string' ? body.media_type : undefined);

    try {
      const { row, deduped } = booty.add({
        blob_hash: blobHash,
        media_type: mediaType,
        original_path: body.original_path,
        byte_size: byteSize,
        branch: typeof body.branch === 'string' ? body.branch : '',
        worktree: typeof body.worktree === 'string' ? body.worktree : null,
        session_id: typeof body.session_id === 'string' ? body.session_id : null,
        agent_identity: typeof body.agent_identity === 'string' ? body.agent_identity : null,
        roadmap_link: typeof body.roadmap_link === 'string' ? body.roadmap_link : null,
        note: typeof body.note === 'string' ? body.note : null,
      });
      reply.code(deduped ? 200 : 201);
      return { success: true, deduped, booty: row };
    } catch (err) {
      const e = err as Error;
      logger?.error?.('booty_add_failed', { error: e.message });
      reply.code(400);
      return { success: false, error: e.message };
    }
  });

  // GET /booty — list provenance rows with filters
  fastify.get('/booty', async (request: FastifyRequest) => {
    const { branch, session, limit } = request.query as Record<string, string | undefined>;
    const opts: { branch?: string; sessionId?: string; limit?: number } = {};
    if (typeof branch === 'string' && branch) opts.branch = branch;
    if (typeof session === 'string' && session) opts.sessionId = session;
    if (typeof limit === 'string') {
      const n = Number.parseInt(limit, 10);
      if (Number.isFinite(n)) opts.limit = n;
    }
    const rows = booty.list(opts);
    return { success: true, booty: rows, count: rows.length };
  });
};
