/**
 * Route tests for the blob store HTTP surface (routes/blob.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createBlobStore } = await import('../../lib/blob.js');
const { blobPlugin } = await import('../../routes/blob.js');

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

describe('blob routes', () => {
  let app;
  let dir;
  let blobs;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pd-blob-routes-'));
    blobs = createBlobStore({ dir });
    app = Fastify();
    await app.register(blobPlugin, { deps: { blobs } });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('POST /blob accepts raw bytes and returns the sha256 id', async () => {
    const buf = Buffer.from('hello blob world');
    const res = await app.inject({
      method: 'POST',
      url: '/blob',
      headers: { 'content-type': 'text/plain' },
      payload: buf,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.blob.id).toBe(sha256Hex(buf));
    expect(body.blob.size).toBe(buf.length);
    expect(body.blob.contentType).toBe('text/plain');
  });

  it('POST /blob preserves binary payloads exactly', async () => {
    const buf = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x10, 0x20]);
    const res = await app.inject({
      method: 'POST',
      url: '/blob',
      headers: { 'content-type': 'application/octet-stream' },
      payload: buf,
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().blob.id;
    expect(id).toBe(sha256Hex(buf));

    const got = await app.inject({ method: 'GET', url: `/blob/${id}` });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('application/octet-stream');
    expect(Buffer.from(got.rawPayload).equals(buf)).toBe(true);
  });

  it('GET /blob/:id streams bytes with the stored Content-Type', async () => {
    const stat = blobs.put(Buffer.from('streamed'), { contentType: 'text/plain' });
    const res = await app.inject({ method: 'GET', url: `/blob/${stat.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['x-blob-id']).toBe(stat.id);
    expect(res.body).toBe('streamed');
  });

  it('GET /blob/:id returns 404 for unknown ids and 400 for malformed ids', async () => {
    const missing = await app.inject({ method: 'GET', url: `/blob/${'a'.repeat(64)}` });
    expect(missing.statusCode).toBe(404);

    const bad = await app.inject({ method: 'GET', url: '/blob/not-a-real-id' });
    expect(bad.statusCode).toBe(400);
  });

  it('HEAD /blob/:id returns headers without a body', async () => {
    const stat = blobs.put(Buffer.from('head-test'), { contentType: 'text/plain' });
    const res = await app.inject({ method: 'HEAD', url: `/blob/${stat.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/plain');
    expect(res.headers['content-length']).toBe(String(stat.size));
    expect(res.body).toBe('');
  });

  it('GET /blob lists stored blobs', async () => {
    const a = blobs.put(Buffer.from('one'));
    const b = blobs.put(Buffer.from('two'));
    const res = await app.inject({ method: 'GET', url: '/blob' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    const ids = body.blobs.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });

  it('DELETE /blob/:id is idempotent', async () => {
    const stat = blobs.put(Buffer.from('to-delete'));
    const first = await app.inject({ method: 'DELETE', url: `/blob/${stat.id}` });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ success: true, deleted: true });

    const second = await app.inject({ method: 'DELETE', url: `/blob/${stat.id}` });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ success: true, deleted: false });
  });

  it('POST /blob rejects payloads larger than the configured cap with 413', async () => {
    const cappedDir = mkdtempSync(join(tmpdir(), 'pd-blob-cap-'));
    const cappedStore = createBlobStore({ dir: cappedDir, maxBytes: 16 });
    const cappedApp = Fastify();
    await cappedApp.register(blobPlugin, { deps: { blobs: cappedStore } });
    await cappedApp.ready();

    try {
      const res = await cappedApp.inject({
        method: 'POST',
        url: '/blob',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.alloc(64, 7),
      });
      // Either Fastify's bodyLimit rejects with 413 or the store rejects with
      // BLOB_TOO_LARGE — both surface as 413 to the caller.
      expect(res.statusCode).toBe(413);
    } finally {
      await cappedApp.close();
      rmSync(cappedDir, { recursive: true, force: true });
    }
  });
});
