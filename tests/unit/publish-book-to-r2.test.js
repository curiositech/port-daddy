/**
 * Tests for the Book's R2 mirror: the one deliberate mutable-key exception in
 * an otherwise fully content-addressed bucket (docs/adr/0142-r2-media-offload.md).
 *
 * No network. Same fake-bucket-over-fetchImpl pattern as
 * tests/unit/r2-media-sync.test.js, extended to answer overwriting PUTs (no
 * `if-none-match`) as well as the conditional ones the archive copy uses.
 */

import { createHash } from 'node:crypto';

import {
  BOOK_CACHE_CONTROL_ARCHIVE,
  BOOK_CACHE_CONTROL_CURRENT,
  BOOK_CURRENT_MANIFEST_KEY,
  BOOK_CURRENT_PDF_KEY,
  BOOK_PUBLIC_BASE_URL,
  archiveKeyFor,
  buildCurrentManifest,
  publishBook,
  putObjectOverwrite,
} from '../../scripts/publish-book-to-r2.mjs';
import { SyncError, readCredentials } from '../../scripts/sync-r2-media.mjs';

const ENV = {
  R2_ACCOUNT_ID: 'acct-1234',
  R2_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
  R2_SECRET_ACCESS_KEY: 'sUpErSeCrEtVaLuE-do-not-log-me',
  R2_BUCKET: 'port-daddy-media',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fakeBucket({ preloaded = [] } = {}) {
  const objects = new Map(preloaded.map((key) => [key, Buffer.alloc(0)]));
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body });
    const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
    if (init.method === 'HEAD') {
      return { status: objects.has(key) ? 200 : 404, ok: objects.has(key), statusText: '' };
    }
    if (init.method === 'PUT') {
      if (objects.has(key) && init.headers['if-none-match'] === '*') {
        return { status: 412, ok: false, statusText: 'Precondition Failed' };
      }
      objects.set(key, Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body));
      return { status: 200, ok: true, statusText: 'OK' };
    }
    throw new Error(`unexpected method ${init.method}`);
  };
  return { objects, requests, fetchImpl };
}

describe('archiveKeyFor', () => {
  test('is content-addressed under book/archive/sha256/', () => {
    const hash = sha256(Buffer.from('hello'));
    expect(archiveKeyFor(hash)).toBe(`book/archive/sha256/${hash}.pdf`);
  });
});

describe('buildCurrentManifest', () => {
  test('names both public URLs and carries every field a caller passed', () => {
    const manifest = buildCurrentManifest({
      sha256Hex: 'abc123',
      bytes: 42,
      pages: 553,
      sourceCommit: 'deadbeef',
      publishedAt: '2026-09-16T00:00:00.000Z',
    });
    expect(manifest.sha256).toBe('abc123');
    expect(manifest.bytes).toBe(42);
    expect(manifest.pages).toBe(553);
    expect(manifest.sourceCommit).toBe('deadbeef');
    expect(manifest.currentUrl).toBe(`${BOOK_PUBLIC_BASE_URL}/${BOOK_CURRENT_PDF_KEY}`);
    expect(manifest.archiveUrl).toBe(`${BOOK_PUBLIC_BASE_URL}/book/archive/sha256/abc123.pdf`);
  });

  test('an absent page count is null, never a guess', () => {
    const manifest = buildCurrentManifest({ sha256Hex: 'abc', bytes: 1, publishedAt: 'now' });
    expect(manifest.pages).toBeNull();
    expect(manifest.sourceCommit).toBeNull();
  });
});

describe('putObjectOverwrite', () => {
  test('replaces an existing key — the one place this codebase clobbers an R2 object on purpose', async () => {
    const bucket = fakeBucket();
    const config = readCredentials(ENV);
    await putObjectOverwrite('book/current.pdf', Buffer.from('v1'), { contentType: 'application/pdf', cacheControl: 'x' }, config, { fetchImpl: bucket.fetchImpl });
    await putObjectOverwrite('book/current.pdf', Buffer.from('v2'), { contentType: 'application/pdf', cacheControl: 'x' }, config, { fetchImpl: bucket.fetchImpl });
    expect(bucket.objects.get('book/current.pdf').toString()).toBe('v2');
    // Never sends the conditional header the archive copy relies on —
    // sending it here would make the second call 412 instead of overwriting.
    for (const request of bucket.requests) expect(request.headers).not.toHaveProperty('if-none-match');
  });
});

describe('publishBook', () => {
  test('writes the immutable archive copy plus both mutable pointers, in that order', async () => {
    const bucket = fakeBucket();
    const config = readCredentials(ENV);
    const pdf = Buffer.from('%PDF-1.5 fixture book bytes');
    const hash = sha256(pdf);

    const manifest = await publishBook(pdf, {
      pages: 553,
      sourceCommit: 'cafef00d',
      config,
      now: () => new Date('2026-09-16T12:00:00.000Z'),
      fetchImpl: bucket.fetchImpl,
    });

    expect(manifest.sha256).toBe(hash);
    expect(bucket.objects.get(`book/archive/sha256/${hash}.pdf`).toString()).toBe(pdf.toString());
    expect(bucket.objects.get('book/current.pdf').toString()).toBe(pdf.toString());
    const written = JSON.parse(bucket.objects.get('book/current.json').toString());
    expect(written.sha256).toBe(hash);
    expect(written.pages).toBe(553);
    expect(written.sourceCommit).toBe('cafef00d');

    // Archive first, current.pdf second, current.json last — so a failure
    // between steps never leaves current.json describing bytes current.pdf
    // does not yet hold.
    const putKeys = bucket.requests.filter((r) => r.method === 'PUT')
      .map((r) => decodeURIComponent(new URL(r.url).pathname.split('/').slice(2).join('/')));
    expect(putKeys).toEqual([`book/archive/sha256/${hash}.pdf`, 'book/current.pdf', 'book/current.json']);
  });

  test('re-publishing byte-identical content skips the archive PUT but still refreshes the pointer', async () => {
    const config = readCredentials(ENV);
    const pdf = Buffer.from('%PDF-1.5 unchanged fixture');
    const hash = sha256(pdf);
    const bucket = fakeBucket({ preloaded: [`book/archive/sha256/${hash}.pdf`] });

    await publishBook(pdf, { config, now: () => new Date(), fetchImpl: bucket.fetchImpl });

    const putKeys = bucket.requests.filter((r) => r.method === 'PUT')
      .map((r) => decodeURIComponent(new URL(r.url).pathname.split('/').slice(2).join('/')));
    expect(putKeys).not.toContain(`book/archive/sha256/${hash}.pdf`);
    expect(putKeys).toEqual(['book/current.pdf', 'book/current.json']);
  });

  test('refuses to publish an empty PDF, before any network call', async () => {
    const config = readCredentials(ENV);
    const bucket = fakeBucket();
    await expect(publishBook(Buffer.alloc(0), { config, fetchImpl: bucket.fetchImpl }))
      .rejects.toThrow(SyncError);
    expect(bucket.requests).toHaveLength(0);
  });

  test('an R2 outage propagates as a SyncError naming the key, not a swallowed failure', async () => {
    const config = readCredentials(ENV);
    const failingFetch = async () => ({ status: 500, ok: false, statusText: 'Internal Server Error' });
    await expect(publishBook(Buffer.from('%PDF-1.5 x'), { config, fetchImpl: failingFetch }))
      .rejects.toThrow(SyncError);
  });

  test('a PUT that fails after a successful archive-existence check still names the key', async () => {
    const config = readCredentials(ENV);
    // HEAD (the archive-existence probe) succeeds and reports "not present";
    // every PUT after it fails — isolates the failure to the upload itself.
    const fetchImpl = async (_url, init) => {
      if (init.method === 'HEAD') return { status: 404, ok: false, statusText: '' };
      return { status: 500, ok: false, statusText: 'Internal Server Error' };
    };
    await expect(publishBook(Buffer.from('%PDF-1.5 x'), { config, fetchImpl }))
      .rejects.toThrow(/failed with 500/);
  });
});

describe('cache-control policy', () => {
  test('the archive copy is immutable; the pointer is not', () => {
    expect(BOOK_CACHE_CONTROL_ARCHIVE).toMatch(/immutable/);
    expect(BOOK_CACHE_CONTROL_CURRENT).not.toMatch(/immutable/);
  });
});
