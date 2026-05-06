/**
 * Blob Routes — content-addressed object store HTTP surface.
 *
 * Phase 0 of the tube-as-coordination-substrate roadmap.
 *
 *   POST   /blob          — upload raw body, store under sha256(body)
 *   GET    /blob          — list { blobs: [...stat] } (limit, since)
 *   GET    /blob/:id      — stream blob bytes with stored Content-Type
 *   HEAD   /blob/:id      — same headers as GET, no body
 *   DELETE /blob/:id      — idempotent delete, returns { deleted: boolean }
 *
 * The plugin registers a wildcard content-type parser the first time it's
 * mounted on a Fastify app so POST /blob can accept truly arbitrary
 * payloads. The parser captures the raw bytes and preserves them on
 * `request.body` as a Buffer.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { BlobStore } from '../lib/blob.js';

interface BlobRouteDeps {
  blobs: BlobStore;
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

const ID_REGEX = /^[0-9a-f]{64}$/;

export const blobPlugin: FastifyPluginAsync<{ deps: BlobRouteDeps }> = async (fastify, opts) => {
  const { blobs, logger } = opts.deps;

  // Raw-body parser registered locally on this plugin scope. Captures any
  // content-type as a Buffer. Bounded by the store's configured maxBytes
  // plus a small headroom; the store will re-validate before writing.
  const bodyLimit = blobs.maxBytes + 1024;
  fastify.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => {
    done(null, body);
  });

  // POST /blob — upload raw bytes
  fastify.post('/blob', { bodyLimit }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body;
    let buf: Buffer;
    if (Buffer.isBuffer(body)) {
      buf = body;
    } else if (typeof body === 'string') {
      buf = Buffer.from(body, 'utf8');
    } else if (body == null) {
      buf = Buffer.alloc(0);
    } else {
      // JSON or other parsed shapes — round-trip through JSON so the body
      // is still addressable. Callers wanting raw bytes should send a
      // non-JSON Content-Type, which the wildcard parser above will catch.
      buf = Buffer.from(JSON.stringify(body), 'utf8');
    }

    const contentType =
      typeof request.headers['content-type'] === 'string'
        ? request.headers['content-type']
        : undefined;

    try {
      const stat = blobs.put(buf, { contentType });
      reply.code(201);
      return { success: true, blob: stat };
    } catch (err) {
      const e = err as Error & { code?: string };
      if (e.code === 'BLOB_TOO_LARGE') {
        reply.code(413);
        return { success: false, error: e.message, code: 'BLOB_TOO_LARGE' };
      }
      logger?.error?.('blob_put_failed', { error: e.message });
      reply.code(500);
      return { success: false, error: 'blob put failed' };
    }
  });

  // GET /blob — list metadata
  fastify.get('/blob', async (request: FastifyRequest) => {
    const { limit, since } = request.query as Record<string, string | undefined>;
    const opts: { limit?: number; since?: number } = {};
    if (typeof limit === 'string') {
      const n = Number.parseInt(limit, 10);
      if (Number.isFinite(n)) opts.limit = n;
    }
    if (typeof since === 'string') {
      const n = Number.parseInt(since, 10);
      if (Number.isFinite(n)) opts.since = n;
    }
    return { success: true, blobs: blobs.list(opts) };
  });

  // GET /blob/:id — stream bytes. Fastify auto-registers HEAD with the same
  // handler; the underlying Node http server strips the body on HEAD, so
  // headers (Content-Type, Content-Length, X-Blob-Id) reach the caller while
  // the body is dropped before going on the wire.
  fastify.get('/blob/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!ID_REGEX.test(id)) {
      reply.code(400);
      return { success: false, error: 'invalid blob id' };
    }
    const stat = blobs.stat(id);
    if (!stat) {
      reply.code(404);
      return { success: false, error: 'blob not found' };
    }
    reply.header('Content-Type', stat.contentType ?? 'application/octet-stream');
    reply.header('Content-Length', String(stat.size));
    reply.header('X-Blob-Id', stat.id);
    reply.header('X-Blob-Created-At', String(stat.createdAt));

    if (request.method === 'HEAD') {
      // For HEAD, preserve the Content-Length we already set above. Calling
      // reply.send() with an empty body would overwrite it with 0, so hijack
      // the raw response and emit headers + end without payload.
      reply.hijack();
      const raw = reply.raw;
      raw.statusCode = 200;
      raw.setHeader('Content-Type', stat.contentType ?? 'application/octet-stream');
      raw.setHeader('Content-Length', String(stat.size));
      raw.setHeader('X-Blob-Id', stat.id);
      raw.setHeader('X-Blob-Created-At', String(stat.createdAt));
      raw.end();
      return;
    }

    const rec = blobs.get(id);
    if (!rec) {
      // Race: blob deleted between stat and get. Treat as 404.
      reply.code(404);
      return { success: false, error: 'blob not found' };
    }
    return reply.send(rec.buffer);
  });

  // DELETE /blob/:id — idempotent
  fastify.delete('/blob/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!ID_REGEX.test(id)) {
      reply.code(400);
      return { success: false, error: 'invalid blob id' };
    }
    const deleted = blobs.delete(id);
    return { success: true, deleted };
  });
};
