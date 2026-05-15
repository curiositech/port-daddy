/**
 * Unit tests for the content-addressed blob store (lib/blob.ts).
 *
 * Each test gets its own scratch directory under os.tmpdir() so tests are
 * fully isolated from each other and from the user's real ~/.port-daddy.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createBlobStore } = await import('../../lib/blob.js');

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

describe('createBlobStore', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-blob-test-'));
    store = createBlobStore({ dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('put + get round trip', () => {
    it('stores arbitrary bytes and returns a sha256 id', () => {
      const buf = Buffer.from('hello world');
      const stat = store.put(buf, { contentType: 'text/plain' });
      expect(stat.id).toBe(sha256Hex(buf));
      expect(stat.size).toBe(buf.length);
      expect(stat.contentType).toBe('text/plain');
      expect(typeof stat.createdAt).toBe('number');
    });

    it('round-trips identical bytes via get', () => {
      const buf = Buffer.from([0, 1, 2, 3, 4, 255, 254, 253]);
      const stat = store.put(buf);
      const rec = store.get(stat.id);
      expect(rec).not.toBeNull();
      expect(rec.buffer.equals(buf)).toBe(true);
      expect(rec.size).toBe(buf.length);
    });

    it('accepts string input and stores as utf-8 bytes', () => {
      const stat = store.put('café');
      const rec = store.get(stat.id);
      expect(rec.buffer.toString('utf8')).toBe('café');
    });

    it('is idempotent — putting the same content twice yields the same id and reuses the file', () => {
      const buf = Buffer.from('idempotent');
      const a = store.put(buf, { contentType: 'text/plain' });
      const b = store.put(buf, { contentType: 'application/octet-stream' });
      expect(a.id).toBe(b.id);
      // First-write content type wins (we never overwrite meta).
      expect(b.contentType).toBe('text/plain');
    });
  });

  describe('size cap', () => {
    it('rejects payloads larger than maxBytes with code BLOB_TOO_LARGE', () => {
      const small = createBlobStore({ dir, maxBytes: 16 });
      const buf = Buffer.alloc(17, 1);
      let caught;
      try {
        small.put(buf);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe('BLOB_TOO_LARGE');
    });
  });

  describe('lookups', () => {
    it('returns null from get/stat for unknown ids', () => {
      const fakeId = 'a'.repeat(64);
      expect(store.get(fakeId)).toBeNull();
      expect(store.stat(fakeId)).toBeNull();
      expect(store.has(fakeId)).toBe(false);
    });

    it('rejects ids that escape the directory or use bad encodings', () => {
      // has/stat/get must never throw and never accept malformed ids.
      expect(store.has('../etc/passwd')).toBe(false);
      expect(store.stat('../etc/passwd')).toBeNull();
      expect(store.get('../etc/passwd')).toBeNull();
      expect(store.has('not-hex-and-too-short')).toBe(false);
      expect(store.stat('A'.repeat(64))).toBeNull(); // uppercase hex rejected
      expect(store.has('z'.repeat(64))).toBe(false);
      // delete also rejects bad ids without touching the filesystem.
      expect(store.delete('../etc/passwd')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns blobs newest-first and respects since', async () => {
      const a = store.put(Buffer.from('a'));
      // Force a measurable gap so createdAt comparison is meaningful.
      await new Promise((r) => setTimeout(r, 5));
      const b = store.put(Buffer.from('b'));
      await new Promise((r) => setTimeout(r, 5));
      const c = store.put(Buffer.from('c'));

      const all = store.list();
      expect(all.map((s) => s.id)).toEqual([c.id, b.id, a.id]);

      const recent = store.list({ since: b.createdAt });
      expect(recent.map((s) => s.id)).toEqual([c.id, b.id]);
    });
  });

  describe('delete', () => {
    it('removes the blob and its meta sidecar idempotently', () => {
      const stat = store.put(Buffer.from('to-delete'), { contentType: 'text/plain' });
      expect(store.delete(stat.id)).toBe(true);
      expect(store.has(stat.id)).toBe(false);
      // Idempotent — second delete returns false but does not throw.
      expect(store.delete(stat.id)).toBe(false);
    });
  });

  describe('gc', () => {
    it('removes old blobs but keeps anything in keepIds', async () => {
      // Margins widened from the original 20ms sleep + 10ms threshold.
      // On macOS-latest node-24 the previous gap was tight enough that
      // GitHub Actions runners — under load and slower fork/promise
      // scheduling on node 24 — occasionally took >10ms between
      // `store.put(fresh)` and `store.gc()`, causing fresh to fall on
      // the wrong side of the cutoff and the assertion at "too new to
      // reap" to fail. Bumping the sleep to 100ms and the cutoff to
      // 50ms keeps the test deterministic without slowing it materially.
      const old1 = store.put(Buffer.from('old-1'));
      const old2 = store.put(Buffer.from('old-2'));
      await new Promise((r) => setTimeout(r, 100));
      const fresh = store.put(Buffer.from('fresh'));

      const result = store.gc({
        olderThanMs: 50,
        keepIds: new Set([old2.id]),
      });

      expect(store.has(old1.id)).toBe(false);
      expect(store.has(old2.id)).toBe(true); // pinned
      expect(store.has(fresh.id)).toBe(true); // too new to reap
      expect(result.removed).toBe(1);
      expect(result.kept).toBeGreaterThanOrEqual(2);
    });

    it('without olderThanMs, keeps everything', () => {
      store.put(Buffer.from('a'));
      store.put(Buffer.from('b'));
      const result = store.gc();
      expect(result.removed).toBe(0);
      expect(result.kept).toBe(2);
    });
  });

  describe('crash recovery', () => {
    it('reaps stray .tmp files at construction time', () => {
      // Simulate a crash mid-write: a .tmp left behind in the blob dir.
      const stray = join(dir, 'crashed-write.tmp');
      writeFileSync(stray, 'partial');
      expect(existsSync(stray)).toBe(true);

      // Re-open the store. Constructor should sweep the .tmp.
      createBlobStore({ dir });
      const remaining = readdirSync(dir).filter((n) => n.endsWith('.tmp'));
      expect(remaining).toEqual([]);
    });
  });
});
