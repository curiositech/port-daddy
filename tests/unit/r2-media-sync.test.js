/**
 * Tests for the R2 media offload: the mechanical offload rule, the
 * regenerate-and-diff drift check, and the upload tool's idempotency,
 * fail-closed behaviour and credential hygiene.
 *
 * No network. The sync tool takes a `fetchImpl`, so every R2 interaction here
 * runs against an in-memory bucket that records the requests it was sent —
 * which is also how the "never prints a credential" claim is testable rather
 * than merely asserted in a comment.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');

import {
  MEDIA_EXTENSIONS,
  OFFLOAD_ROOTS,
  buildManifest,
  contentTypeFor,
  isOffloadable,
  objectKeyFor,
  serializeManifest,
  trackedFiles,
} from '../../scripts/r2-media-manifest.mjs';
import { findReferrers } from '../../scripts/r2-offload-move.mjs';
import { verifyEntry } from '../../scripts/verify-r2-public-reads.mjs';
import { diffManifests } from '../../scripts/check-r2-media-manifest.mjs';
import {
  REQUIRED_ENV,
  SyncError,
  encodeRfc3986,
  readCredentials,
  redactUrl,
  signRequest,
  syncManifest,
  verifyAssetsOnDisk,
} from '../../scripts/sync-r2-media.mjs';

const ENV = {
  R2_ACCOUNT_ID: 'acct-1234',
  R2_ACCESS_KEY_ID: 'AKIAEXAMPLEKEYID',
  R2_SECRET_ACCESS_KEY: 'sUpErSeCrEtVaLuE-do-not-log-me',
  R2_BUCKET: 'port-daddy-media',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** A throwaway git repo, so `git ls-files` (the manifest's input) is real. */
function makeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'r2-media-'));
  for (const [path, contents] of Object.entries(files)) {
    const abs = join(root, path);
    mkdirSync(resolve(abs, '..'), { recursive: true });
    writeFileSync(abs, contents);
  }
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-A']);
  return root;
}

/** In-memory R2. Records every request so we can assert on what was sent. */
function fakeBucket({ preloaded = [] } = {}) {
  const objects = new Map(preloaded.map((key) => [key, Buffer.alloc(0)]));
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, headers: init.headers });
    const key = decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));
    if (init.method === 'HEAD') {
      return { status: objects.has(key) ? 200 : 404, ok: objects.has(key), statusText: '' };
    }
    if (init.method === 'PUT') {
      if (objects.has(key) && init.headers['if-none-match'] === '*') {
        return { status: 412, ok: false, statusText: 'Precondition Failed' };
      }
      objects.set(key, Buffer.from(init.body));
      return { status: 200, ok: true, statusText: 'OK' };
    }
    throw new Error(`unexpected method ${init.method}`);
  };
  return { objects, requests, fetchImpl };
}

// ---------------------------------------------------------------------------

describe('the offload rule is mechanical', () => {
  test('a media file under an offload root is offloaded', () => {
    expect(isOffloadable('docs/pr-assets/screenshot.png')).toBe(true);
    expect(isOffloadable('website-v2/screenshots/home.jpg')).toBe(true);
    expect(isOffloadable('docs/reports/deep/nested/tour.gif')).toBe(true);
  });

  test('build inputs are never offloaded, whatever their size', () => {
    // website-v2/public is copied into dist by vite; a plate is resolved by
    // pdflatex. An unreachable R2 must never be able to break a build.
    expect(isOffloadable('website-v2/public/whitepaper/coordination-papers-mega-volume.pdf')).toBe(false);
    expect(isOffloadable('website-v2/public/whitepaper/plates/swiss/cover.jpg')).toBe(false);
    expect(isOffloadable('core/pd-console/fixtures/frame.png')).toBe(false);
  });

  test('non-media under an offload root stays in git', () => {
    expect(isOffloadable('docs/pr-assets/notes.md')).toBe(false);
    expect(isOffloadable('docs/reports/data.json')).toBe(false);
    // SVG is text: it diffs, it is tiny, and it is reviewable in a PR.
    expect(isOffloadable('docs/pr-assets/diagram.svg')).toBe(false);
  });

  test('the rule has no size term at all — that is the point', () => {
    // A 1-byte png under an offload root and a 100 MiB one get the same answer.
    // Any threshold is a number somebody has to defend per file.
    const source = readFileSync(join(REPO_ROOT, 'scripts/r2-media-manifest.mjs'), 'utf8');
    const start = source.indexOf('export function isOffloadable');
    // The function body only — up to its closing brace in column 0. Slicing to
    // the NEXT export would sweep in the doc comment that follows it, and
    // prose about bytes is not a size term in the rule.
    const ruleBody = source.slice(start, source.indexOf('\n}', start) + 2);
    expect(ruleBody).toContain('isOffloadable');
    expect(ruleBody).not.toMatch(/statSync|\.size|bytes|length\s*[<>]/u);
  });

  test('extension matching is case-insensitive', () => {
    expect(isOffloadable('docs/pr-assets/SHOT.PNG')).toBe(true);
    expect(contentTypeFor('docs/pr-assets/SHOT.PNG')).toBe('image/png');
  });

  test('every offload root ends in a slash, so a sibling cannot be swept in', () => {
    for (const root of OFFLOAD_ROOTS) expect(root.endsWith('/')).toBe(true);
    // `docs/reports/` must not match `docs/reports-archive/foo.png`.
    expect(isOffloadable('docs/reports-archive/foo.png')).toBe(false);
  });

  test('every declared media extension is lowercase and dotted', () => {
    for (const ext of MEDIA_EXTENSIONS) expect(ext).toMatch(/^\.[a-z0-9]+$/u);
  });
});

describe('content addressing makes a redeploy of identical bytes a no-op', () => {
  test('the key is derived from the bytes, not the path', () => {
    const hash = sha256(Buffer.from('same bytes'));
    // Two completely different paths, same bytes, same extension -> same key.
    expect(objectKeyFor(hash, 'docs/pr-assets/a.png'))
      .toBe(objectKeyFor(hash, 'docs/reports/somewhere/else/deeply/nested/b.png'));
    expect(objectKeyFor(hash, 'docs/pr-assets/a.png')).toBe(`sha256/${hash.slice(0, 2)}/${hash}.png`);
    // The extension is the only part of the path that survives into the key.
    expect(objectKeyFor(hash, 'docs/pr-assets/a.gif')).toBe(`sha256/${hash.slice(0, 2)}/${hash}.gif`);
  });

  test('two paths with identical bytes collapse to one object', () => {
    const root = makeRepo({
      'docs/pr-assets/one.png': 'identical',
      'docs/reports/two.png': 'identical',
      'docs/pr-media/different.png': 'other',
    });
    try {
      const manifest = buildManifest(root);
      expect(manifest.counts.assets).toBe(3);
      expect(manifest.counts.distinctObjects).toBe(2);
      expect(manifest.assets[0].key).toBe(manifest.assets[2].key);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('regenerating an unchanged tree produces byte-identical output', () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'x', 'docs/reports/b.gif': 'y' });
    try {
      expect(serializeManifest(buildManifest(root))).toBe(serializeManifest(buildManifest(root)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('cache-control is immutable, which content addressing earns', () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'x' });
    try {
      expect(buildManifest(root).cacheControl).toBe('public, max-age=31536000, immutable');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the drift check catches every way the manifest can go stale', () => {
  const build = (files) => {
    const root = makeRepo(files);
    try {
      return { manifest: buildManifest(root), root };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  test('a clean manifest has no findings', () => {
    const { manifest } = build({ 'docs/pr-assets/a.png': 'x' });
    expect(diffManifests(manifest, manifest)).toEqual([]);
  });

  test('an added asset the manifest does not know about fails', () => {
    const { manifest: before } = build({ 'docs/pr-assets/a.png': 'x' });
    const { manifest: after } = build({ 'docs/pr-assets/a.png': 'x', 'docs/pr-assets/new.png': 'z' });
    const failures = diffManifests(before, after);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('docs/pr-assets/new.png');
    expect(failures[0]).toContain('not in the manifest');
  });

  test('a deleted asset the manifest still lists fails', () => {
    const { manifest: before } = build({ 'docs/pr-assets/a.png': 'x', 'docs/pr-assets/gone.png': 'z' });
    const { manifest: after } = build({ 'docs/pr-assets/a.png': 'x' });
    const failures = diffManifests(before, after);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('docs/pr-assets/gone.png');
  });

  test('an EDITED asset fails — the bytes moved, so the key moved', () => {
    // This is the case a "does the list contain the path" check cannot see:
    // the path is in both lists and both lists are wrong together.
    const { manifest: before } = build({ 'docs/pr-assets/a.png': 'original' });
    const { manifest: after } = build({ 'docs/pr-assets/a.png': 'RETOUCHED' });
    const failures = diffManifests(before, after);
    expect(failures.some((f) => f.includes('content drift'))).toBe(true);
    expect(failures.some((f) => f.includes('key drift'))).toBe(true);
    expect(failures.some((f) => f.includes('size drift'))).toBe(true);
  });

  test('a hand-added manifest entry with no file behind it fails', () => {
    const { manifest } = build({ 'docs/pr-assets/a.png': 'x' });
    const tampered = {
      ...manifest,
      assets: [...manifest.assets, {
        path: 'docs/pr-assets/imaginary.png',
        bytes: 1,
        sha256: '0'.repeat(64),
        key: `sha256/00/${'0'.repeat(64)}.png`,
        contentType: 'image/png',
      }],
    };
    const failures = diffManifests(tampered, manifest);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('imaginary.png');
  });

  test('a hand-edited hash fails even when the path list is right', () => {
    const { manifest } = build({ 'docs/pr-assets/a.png': 'x' });
    const tampered = {
      ...manifest,
      assets: manifest.assets.map((a) => ({ ...a, sha256: 'f'.repeat(64) })),
    };
    expect(diffManifests(tampered, manifest).some((f) => f.includes('content drift'))).toBe(true);
  });
});

describe('the sync tool is idempotent', () => {
  const manifestFor = (root) => buildManifest(root);

  test('a second run against an unchanged bucket uploads nothing', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa', 'docs/reports/b.gif': 'bbb' });
    try {
      const manifest = manifestFor(root);
      const bucket = fakeBucket();
      const config = readCredentials(ENV);

      const first = await syncManifest(manifest, root, config, { fetchImpl: bucket.fetchImpl, log: () => {} });
      expect(first.uploaded).toBe(2);
      expect(first.present).toBe(0);

      const second = await syncManifest(manifest, root, config, { fetchImpl: bucket.fetchImpl, log: () => {} });
      expect(second.uploaded).toBe(0);
      expect(second.present).toBe(2);
      expect(bucket.requests.filter((r) => r.method === 'PUT')).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('only the changed asset is uploaded on the next run', async () => {
    const rootA = makeRepo({ 'docs/pr-assets/a.png': 'aaa', 'docs/reports/b.gif': 'bbb' });
    const rootB = makeRepo({ 'docs/pr-assets/a.png': 'aaa', 'docs/reports/b.gif': 'CHANGED' });
    try {
      const bucket = fakeBucket();
      const config = readCredentials(ENV);
      await syncManifest(manifestFor(rootA), rootA, config, { fetchImpl: bucket.fetchImpl, log: () => {} });
      const next = await syncManifest(manifestFor(rootB), rootB, config, { fetchImpl: bucket.fetchImpl, log: () => {} });
      expect(next.uploaded).toBe(1);
      expect(next.present).toBe(1);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  test('duplicate bytes across two paths cause one PUT, not two', async () => {
    const root = makeRepo({ 'docs/pr-assets/one.png': 'same', 'docs/reports/two.png': 'same' });
    try {
      const bucket = fakeBucket();
      const result = await syncManifest(manifestFor(root), root, readCredentials(ENV), {
        fetchImpl: bucket.fetchImpl, log: () => {},
      });
      expect(result.total).toBe(1);
      expect(result.uploaded).toBe(1);
      expect(bucket.requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a racing writer that won is treated as present, not as a failure', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const manifest = manifestFor(root);
      // HEAD says absent, but the object appears before our PUT lands: the
      // If-None-Match:* PUT comes back 412 and we accept it.
      const objects = new Map();
      let headCount = 0;
      const fetchImpl = async (url, init) => {
        if (init.method === 'HEAD') { headCount += 1; return { status: 404, ok: false, statusText: '' }; }
        objects.set('raced', 1);
        return { status: 412, ok: false, statusText: 'Precondition Failed' };
      };
      const result = await syncManifest(manifest, root, readCredentials(ENV), { fetchImpl, log: () => {} });
      expect(headCount).toBe(1);
      expect(result.uploaded).toBe(0);
      expect(result.present).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a PUT carries the immutable cache-control, the content type, and If-None-Match', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const bucket = fakeBucket();
      await syncManifest(manifestFor(root), root, readCredentials(ENV), {
        fetchImpl: bucket.fetchImpl, log: () => {},
      });
      const put = bucket.requests.find((r) => r.method === 'PUT');
      expect(put.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(put.headers['content-type']).toBe('image/png');
      expect(put.headers['if-none-match']).toBe('*');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('--dry-run issues HEADs but no PUTs', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const bucket = fakeBucket();
      const result = await syncManifest(manifestFor(root), root, readCredentials(ENV), {
        dryRun: true, fetchImpl: bucket.fetchImpl, log: () => {},
      });
      expect(result.wouldUpload).toBe(1);
      expect(result.uploaded).toBe(0);
      expect(bucket.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
      expect(bucket.requests.filter((r) => r.method === 'HEAD')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the sync tool fails closed', () => {
  test.each(REQUIRED_ENV)('a missing %s is refused before any network call', (name) => {
    const env = { ...ENV };
    delete env[name];
    expect(() => readCredentials(env)).toThrow(SyncError);
    expect(() => readCredentials(env)).toThrow(name);
  });

  test('a blank or whitespace credential counts as missing', () => {
    expect(() => readCredentials({ ...ENV, R2_SECRET_ACCESS_KEY: '' })).toThrow(SyncError);
    expect(() => readCredentials({ ...ENV, R2_SECRET_ACCESS_KEY: '   ' })).toThrow(SyncError);
  });

  test('a missing credential exits 2, not 0 — there is no unauthenticated mode', () => {
    try {
      readCredentials({});
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SyncError);
      expect(error.exitCode).toBe(2);
    }
  });

  test('an asset missing from disk aborts the whole sync before uploading anything', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const manifest = buildManifest(root);
      rmSync(join(root, 'docs/pr-assets/a.png'));
      const bucket = fakeBucket();
      await expect(
        syncManifest(manifest, root, readCredentials(ENV), { fetchImpl: bucket.fetchImpl, log: () => {} }),
      ).rejects.toThrow(/not on disk/u);
      expect(bucket.requests).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('bytes whose hash disagrees with the manifest abort the sync', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const manifest = buildManifest(root);
      writeFileSync(join(root, 'docs/pr-assets/a.png'), 'TAMPERED');
      expect(verifyAssetsOnDisk(manifest, root)).toHaveLength(1);
      const bucket = fakeBucket();
      await expect(
        syncManifest(manifest, root, readCredentials(ENV), { fetchImpl: bucket.fetchImpl, log: () => {} }),
      ).rejects.toThrow(/manifest says/u);
      // Nothing was uploaded: an object at a key that does not describe its
      // bytes would be undetectable afterwards.
      expect(bucket.requests).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an unexpected HEAD status is an error, never an assumption', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const fetchImpl = async () => ({ status: 503, ok: false, statusText: 'Service Unavailable' });
      await expect(
        syncManifest(buildManifest(root), root, readCredentials(ENV), { fetchImpl, log: () => {} }),
      ).rejects.toThrow(/503/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a failed PUT rejects rather than reporting success', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const fetchImpl = async (url, init) => (init.method === 'HEAD'
        ? { status: 404, ok: false, statusText: '' }
        : { status: 403, ok: false, statusText: 'Forbidden' });
      await expect(
        syncManifest(buildManifest(root), root, readCredentials(ENV), { fetchImpl, log: () => {} }),
      ).rejects.toThrow(/403/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('buildManifest refuses an incomplete checkout rather than dropping assets', () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      rmSync(join(root, 'docs/pr-assets/a.png'));
      expect(() => buildManifest(root)).toThrow(/incomplete checkout/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('a credential value never reaches a log or a serialization', () => {
  const SECRET = ENV.R2_SECRET_ACCESS_KEY;

  test('the config does not carry the secret in any enumerable form', () => {
    const config = readCredentials(ENV);
    expect(JSON.stringify(config)).not.toContain(SECRET);
    expect(Object.keys(config)).not.toContain('secretAccessKey');
    expect(JSON.stringify(config)).toContain('[redacted]');
    // It is still usable for signing.
    expect(config.secretAccessKey).toBe(SECRET);
  });

  test('no log line emitted during a full sync contains the secret', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa', 'docs/reports/b.gif': 'bbb' });
    try {
      const lines = [];
      const bucket = fakeBucket();
      await syncManifest(buildManifest(root), root, readCredentials(ENV), {
        fetchImpl: bucket.fetchImpl,
        log: (line) => lines.push(line),
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).not.toContain(SECRET);
        expect(line).not.toContain(ENV.R2_ACCESS_KEY_ID);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('an error message names the key and the status, never the credential', async () => {
    const root = makeRepo({ 'docs/pr-assets/a.png': 'aaa' });
    try {
      const fetchImpl = async () => ({ status: 500, ok: false, statusText: 'Internal Server Error' });
      await syncManifest(buildManifest(root), root, readCredentials(ENV), { fetchImpl, log: () => {} });
      throw new Error('expected a throw');
    } catch (error) {
      expect(error.message).not.toContain(SECRET);
      expect(error.message).toContain('sha256/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('redactUrl strips a query string, so a presigned URL cannot leak', () => {
    expect(redactUrl('https://x.r2.cloudflarestorage.com/b/k?X-Amz-Signature=deadbeef'))
      .toBe('https://x.r2.cloudflarestorage.com/b/k?[redacted]');
    expect(redactUrl('https://x/b/k')).toBe('https://x/b/k');
  });
});

describe('request signing', () => {
  const config = readCredentials(ENV);

  test('a signature is deterministic for a fixed clock and changes with the key', () => {
    const at = new Date('2026-09-14T12:00:00Z');
    const one = signRequest({ method: 'HEAD', key: 'sha256/aa/aa.png', headers: {}, payloadHash: 'e3b0c4', config, now: at });
    const again = signRequest({ method: 'HEAD', key: 'sha256/aa/aa.png', headers: {}, payloadHash: 'e3b0c4', config, now: at });
    const other = signRequest({ method: 'HEAD', key: 'sha256/bb/bb.png', headers: {}, payloadHash: 'e3b0c4', config, now: at });
    expect(one.headers.Authorization).toBe(again.headers.Authorization);
    expect(one.headers.Authorization).not.toBe(other.headers.Authorization);
  });

  test('the Authorization header carries the key id but never the secret', () => {
    const signed = signRequest({
      method: 'PUT', key: 'sha256/aa/aa.png', headers: {}, payloadHash: 'e3b0c4', config,
      now: new Date('2026-09-14T12:00:00Z'),
    });
    expect(signed.headers.Authorization).toContain(ENV.R2_ACCESS_KEY_ID);
    expect(signed.headers.Authorization).not.toContain(ENV.R2_SECRET_ACCESS_KEY);
  });

  test('the request URL targets the bucket and the key', () => {
    const signed = signRequest({
      method: 'HEAD', key: 'sha256/aa/aabb.png', headers: {}, payloadHash: 'e3b0c4', config,
      now: new Date('2026-09-14T12:00:00Z'),
    });
    expect(signed.url).toBe(
      'https://acct-1234.r2.cloudflarestorage.com/port-daddy-media/sha256/aa/aabb.png',
    );
  });

  test('encodeRfc3986 keeps slashes in a path but escapes the reserved set', () => {
    expect(encodeRfc3986('a/b c', { keepSlashes: true })).toBe('a/b%20c');
    expect(encodeRfc3986('a/b', { keepSlashes: false })).toBe('a%2Fb');
    expect(encodeRfc3986("it's(1)*")).toBe('it%27s%281%29%2A');
  });
});

describe('the committed manifest describes this repository', () => {
  const repoRoot = REPO_ROOT;

  test('media/r2-manifest.json matches regeneration byte-for-byte', () => {
    const committed = readFileSync(join(repoRoot, 'media/r2-manifest.json'), 'utf8');
    expect(committed).toBe(serializeManifest(buildManifest(repoRoot)));
  });

  // RENAMED, because the old name was a claim this assertion cannot support.
  //
  // This was called 'no offloaded asset is something a build reads' and it
  // checked two hardcoded prefixes. That is a list checked against itself --
  // precisely the shape ADR-0142 §10 was written to condemn, and it was green
  // the whole time two manifest files were being hashed by
  // tests/unit/spawn-whitepaper-contract.test.js and three more by
  // apps/FleetBar/Tests/FleetBarTests/SquidHarnessSnapshotTests.swift.
  //
  // Mirroring a file to R2 while it stays in git is harmless whoever reads it,
  // so the honest assertion at Phase 1 is just that the two build-input trees
  // the rule excludes are in fact excluded. The real invariant -- nothing reads
  // this file -- belongs to Phase 2, and is asserted below against
  // media/r2-offloaded.json, which is the list of files actually removed.
  test('the rule excludes the two trees a build reads from', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'media/r2-manifest.json'), 'utf8'));
    for (const asset of manifest.assets) {
      expect(asset.path.startsWith('website-v2/public/')).toBe(false);
      expect(asset.path).not.toContain('/plates/');
    }
  });

  test('every manifest key is content-addressed under sha256/', () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'media/r2-manifest.json'), 'utf8'));
    for (const asset of manifest.assets) {
      expect(asset.key).toBe(objectKeyFor(asset.sha256, asset.path));
      expect(asset.key.startsWith('sha256/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2: the files that are no longer in git.
//
// media/r2-manifest.json cannot speak for these -- it is a projection of the
// tree, and they are deliberately not in the tree. media/r2-offloaded.json is,
// so the invariants that matter at Phase 2 are asserted against that file.
// ---------------------------------------------------------------------------
describe('offloaded files are gone from git and readable from R2', () => {
  const offloadedPath = join(REPO_ROOT, 'media/r2-offloaded.json');
  const offloaded = existsSync(offloadedPath)
    ? JSON.parse(readFileSync(offloadedPath, 'utf8'))
    : { entries: [], publicBase: 'https://media.portdaddy.dev' };

  test('every entry is content-addressed by its own sha256', () => {
    for (const entry of offloaded.entries) {
      expect(entry.key).toBe(objectKeyFor(entry.sha256, entry.path));
      expect(entry.url).toBe(`${offloaded.publicBase}/${entry.key}`);
    }
  });

  test('no offloaded path is still tracked by git', () => {
    const tracked = new Set(trackedFiles(REPO_ROOT));
    for (const entry of offloaded.entries) {
      expect(tracked.has(entry.path)).toBe(false);
    }
  });

  // THE Phase 2 invariant. A file that left git must have had no reader other
  // than prose, because prose was rewritten to the URL and anything else would
  // now be resolving a path that does not exist. This is the assertion the old
  // 'no offloaded asset is something a build reads' test was named after but
  // did not make.
  test('nothing but prose ever referenced an offloaded file', () => {
    if (offloaded.entries.length === 0) return;
    const names = new Set(offloaded.entries.map((e) => e.path.split('/').pop()));
    const textFiles = trackedFiles(REPO_ROOT).filter((f) => !isOffloadable(f));
    const referrers = findReferrers(REPO_ROOT, names, textFiles);
    const consumers = [];
    for (const [name, hits] of referrers) {
      for (const [file, kind] of hits) if (kind === 'consumer') consumers.push(`${name} <- ${file}`);
    }
    expect(consumers).toEqual([]);
  });

  test('the manifest and the offloaded list are disjoint', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'media/r2-manifest.json'), 'utf8'));
    const manifestPaths = new Set(manifest.assets.map((a) => a.path));
    for (const entry of offloaded.entries) expect(manifestPaths.has(entry.path)).toBe(false);
  });
});

describe('the public-read check needs no credentials and verifies bytes', () => {
  const entry = {
    path: 'docs/pr-assets/pr-1/shot.png',
    bytes: 3,
    sha256: createHash('sha256').update(Buffer.from('abc')).digest('hex'),
    contentType: 'image/png',
  };
  entry.key = objectKeyFor(entry.sha256, entry.path);
  entry.url = `https://media.portdaddy.dev/${entry.key}`;

  const respond = (status, type, body) => async () => ({
    status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    arrayBuffer: async () => Buffer.from(body),
  });

  test('a correct object passes', async () => {
    expect(await verifyEntry(entry, { fetchImpl: respond(200, 'image/png', 'abc') })).toBeNull();
  });

  test('a 404 fails and says the public cannot read it', async () => {
    const failure = await verifyEntry(entry, { fetchImpl: respond(404, 'text/plain', '') });
    expect(failure).toMatch(/answered 404/);
  });

  test('a wrong content-type fails', async () => {
    const failure = await verifyEntry(entry, { fetchImpl: respond(200, 'application/octet-stream', 'abc') });
    expect(failure).toMatch(/served as 'application\/octet-stream'/);
  });

  // The failure the REST upload path cannot prevent: a key overwritten with
  // different bytes. A status check alone would call this healthy.
  test('right status, right type, WRONG BYTES fails', async () => {
    const failure = await verifyEntry(entry, { fetchImpl: respond(200, 'image/png', 'xyz') });
    expect(failure).toMatch(/does not describe itself|served bytes hash/);
  });

  test('a truncated body fails on length before it is hashed', async () => {
    const failure = await verifyEntry(entry, { fetchImpl: respond(200, 'image/png', 'ab') });
    expect(failure).toMatch(/served 2 bytes, expected 3/);
  });

  test('verifyEntry reads no credential from the environment', async () => {
    const before = { ...process.env };
    for (const name of ['CLOUDFLARE_API_TOKEN', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID']) {
      delete process.env[name];
    }
    try {
      expect(await verifyEntry(entry, { fetchImpl: respond(200, 'image/png', 'abc') })).toBeNull();
    } finally {
      process.env = before;
    }
  });
});
