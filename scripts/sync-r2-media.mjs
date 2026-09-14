#!/usr/bin/env node
// Upload every asset in media/r2-manifest.json that R2 does not already hold.
//
// IDEMPOTENT BY CONSTRUCTION, NOT BY CARE. The key is the sha256 of the bytes
// (`sha256/ab/abcdef….png`), so "is this object already there" is a question
// about the key alone. The tool HEADs the key; a 200 means those exact bytes are
// already stored and it moves on. The PUT that follows a 404 carries
// `If-None-Match: *`, so even if two CI runs race on the same new asset the
// second gets 412 and neither clobbers the other. Re-running the sync against an
// unchanged tree issues N HEADs and zero PUTs. Re-running it against a tree where
// one screenshot was re-rendered uploads exactly that one object.
//
// FAIL CLOSED. Every exit that is not "the manifest is fully uploaded" is a
// non-zero exit:
//   - a missing or blank credential  -> exit 2, before any network call
//   - a manifest that drifted from the tree -> exit 2, before any upload
//   - an asset in the manifest that is not on disk -> exit 1
//   - bytes on disk whose hash is not the hash in the manifest -> exit 1
//   - any upload that does not end 2xx -> exit 1
// There is deliberately no "warn and continue" path and no flag to add one. A
// sync that half-worked and exited 0 would publish a page whose images 404.
//
// CREDENTIALS ARE NEVER PRINTED. The access key id, the secret, the derived
// signing key and the Authorization header are never logged, not at any verbosity
// and not in an error path: failures report status codes and keys. `redactUrl()`
// strips any query string before a URL reaches the console, so a future move to
// presigned URLs cannot turn a log line into a credential leak.
//
// Node stdlib only — SigV4 is ~50 lines of node:crypto, and a zero-install tool
// runs identically on a laptop and on a CI runner with no lockfile in the way.
//
// Usage:
//   node scripts/sync-r2-media.mjs [--dry-run] [--concurrency N] [--manifest PATH]
// Environment (all four required, none optional):
//   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manifestPath, repoRootFromHere, sha256Of } from './r2-media-manifest.mjs';

export const REQUIRED_ENV = Object.freeze([
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
]);

// The second, weaker transport. See the TRANSPORTS note above: this exists
// because an account-owned Cloudflare API token cannot be turned into an S3
// access key id, not because two ways of doing this are desirable.
export const REQUIRED_ENV_REST = Object.freeze([
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'CLOUDFLARE_API_TOKEN',
]);

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/** Thrown for every fail-closed condition, so the CLI has one exit path. */
export class SyncError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message);
    this.name = 'SyncError';
    this.exitCode = exitCode;
  }
}

/**
 * Read credentials from an environment. Returns a config whose secret is present
 * but which has no `toJSON`/`toString` that would ever render it: the object is
 * frozen and the secret lives on a non-enumerable property, so `console.log(cfg)`,
 * `JSON.stringify(cfg)` and a template literal all show `[redacted]` rather than
 * the value. That is not paranoia theatre — CI logs are world-readable on a
 * public repo, and one careless debug line is a permanent credential disclosure.
 *
 * Fail closed: a variable that is absent, empty, or whitespace is missing.
 */
export function readCredentials(env = process.env) {
  const present = (name) => Boolean(env[name] && env[name].trim() !== '');

  // Transport selection is explicit and S3-first. The REST transport is only
  // chosen when the S3 secret is genuinely absent AND a Cloudflare API token is
  // genuinely present, so a half-configured environment can never silently
  // downgrade to the weaker path -- it fails closed on the S3 branch instead.
  if (!present('R2_SECRET_ACCESS_KEY') && !present('R2_ACCESS_KEY_ID') && present('CLOUDFLARE_API_TOKEN')) {
    const missingRest = REQUIRED_ENV_REST.filter((name) => !present(name));
    if (missingRest.length > 0) {
      throw new SyncError(
        `missing required environment variable(s): ${missingRest.join(', ')}. `
        + 'This run selected the REST transport because CLOUDFLARE_API_TOKEN is set; '
        + 'see docs/adr/0142-r2-media-offload.md §7.',
        { exitCode: 2 },
      );
    }
    const restConfig = {
      transport: 'rest',
      accountId: env.R2_ACCOUNT_ID.trim(),
      bucket: env.R2_BUCKET.trim(),
      endpoint: `${CLOUDFLARE_API_BASE}/accounts/${env.R2_ACCOUNT_ID.trim()}`
        + `/r2/buckets/${env.R2_BUCKET.trim()}`,
      toJSON() {
        return {
          transport: 'rest', accountId: this.accountId, bucket: this.bucket, apiToken: '[redacted]',
        };
      },
    };
    Object.defineProperty(restConfig, 'apiToken', {
      value: env.CLOUDFLARE_API_TOKEN.trim(),
      enumerable: false,
      writable: false,
    });
    return Object.freeze(restConfig);
  }

  const missing = REQUIRED_ENV.filter((name) => !present(name));
  if (missing.length > 0) {
    throw new SyncError(
      `missing required environment variable(s): ${missing.join(', ')}. `
      + 'Set them from the repository secrets (see docs/adr/0142-r2-media-offload.md); '
      + 'this tool will not run without credentials and has no unauthenticated mode. '
      + '(To use an account-owned Cloudflare API token instead of S3 keys, set '
      + 'CLOUDFLARE_API_TOKEN with R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY both unset.)',
      { exitCode: 2 },
    );
  }

  const config = {
    transport: 's3',
    accountId: env.R2_ACCOUNT_ID.trim(),
    accessKeyId: env.R2_ACCESS_KEY_ID.trim(),
    bucket: env.R2_BUCKET.trim(),
    endpoint: `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
    region: 'auto',
    toJSON() {
      return { accountId: this.accountId, bucket: this.bucket, accessKeyId: '[redacted]', secretAccessKey: '[redacted]' };
    },
  };
  Object.defineProperty(config, 'secretAccessKey', {
    value: env.R2_SECRET_ACCESS_KEY.trim(),
    enumerable: false,
    writable: false,
  });
  return Object.freeze(config);
}

/** Never let a query string (a presigned signature lives there) reach a log. */
export function redactUrl(url) {
  const index = url.indexOf('?');
  return index === -1 ? url : `${url.slice(0, index)}?[redacted]`;
}

// --------------------------------------------------------------------------
// AWS SigV4 for the R2 S3-compatible endpoint.
// --------------------------------------------------------------------------

const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');

/** RFC 3986 encoding, with `/` preserved when encoding a path. */
export function encodeRfc3986(value, { keepSlashes = false } = {}) {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlashes ? encoded.split('%2F').join('/') : encoded;
}

export function signRequest({ method, key, headers, payloadHash, config, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/gu, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const canonicalUri = `/${encodeRfc3986(config.bucket, { keepSlashes: true })}/${encodeRfc3986(key, { keepSlashes: true })}`;

  const allHeaders = {
    ...headers,
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedNames = Object.keys(allHeaders)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = signedNames
    .map((name) => {
      const value = Object.entries(allHeaders).find(([k]) => k.toLowerCase() === name)[1];
      return `${name}:${String(value).trim().replace(/\s+/gu, ' ')}\n`;
    })
    .join('');
  const signedHeaders = signedNames.join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    '', // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), config.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${config.endpoint}${canonicalUri}`,
    headers: {
      ...allHeaders,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

// --------------------------------------------------------------------------
// The two operations.
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// The REST transport, and exactly what it costs.
//
// The S3 endpoint needs an access key id, which R2 derives from an R2 API
// TOKEN ID. An account-owned Cloudflare API token has no retrievable id -- it
// cannot call /user/tokens/verify (it is not user-owned) and listing account
// tokens needs a permission this token does not carry -- so the S3 path is not
// reachable with that credential at all. This transport is what makes the tool
// runnable with the credential that actually exists.
//
// Three measured differences from the S3 path, none of them cosmetic:
//
//   1. HEAD is 405 on this API, and Range is ignored (a Range: bytes=0-0 GET
//      still transfers the whole object). A per-key existence probe would
//      therefore download the entire bucket to answer "is it there". So this
//      transport LISTS the bucket once and answers from that set.
//
//   2. `If-None-Match: *` IS IGNORED. Measured, not assumed: a conditional PUT
//      onto an existing key returned 200 and replaced the object. The atomic
//      create-if-absent that ADR-0142 §8 rests on does not exist here, so
//      "append-only" is enforced by the tool skipping keys it listed, and by
//      verifyAssetsOnDisk() proving the bytes hash to the key before any PUT --
//      not by the store refusing the write. Two racing runs on the same NEW
//      asset can both PUT; because the key is the hash and the hash was
//      re-verified, they write identical bytes, so the object is correct either
//      way. That is a weaker guarantee than 412 and it is stated rather than
//      glossed.
//
//   3. A clobbered object is invisible from the edge for up to a year. The
//      objects carry `immutable, max-age=31536000`, so a bad overwrite keeps
//      serving the OLD cached bytes while the origin holds the new ones.
//      Verification therefore has to read the origin, not the CDN, whenever it
//      is checking that a write landed.
//
// Prefer the S3 transport whenever a real R2 Object Read & Write token exists.
// --------------------------------------------------------------------------

/** Authorization for the REST transport. Never logged; see redactUrl(). */
function restHeaders(config, extra = {}) {
  return { Authorization: `Bearer ${config.apiToken}`, ...extra };
}

/** The object URL for a key. Keys are `sha256/ab/<hex><ext>` -- path-safe already. */
export function restObjectUrl(key, config) {
  return `${config.endpoint}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Every key the bucket already holds, in one paginated pass.
 *
 * This replaces 782 existence probes with a few list calls. It fails closed on
 * any non-2xx and on a truncated page it cannot continue, because an
 * under-reported key set would cause re-uploads (harmless) but an
 * over-reported one would cause a MISSING object to be treated as present
 * (not harmless at all) -- so the listing is only ever allowed to be complete.
 */
export async function listExistingKeys(config, { fetchImpl = fetch, log = () => {} } = {}) {
  const keys = new Set();
  let cursor = null;
  for (let page = 0; page < 10000; page += 1) {
    const url = `${config.endpoint}/objects?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const response = await fetchImpl(url, { headers: restHeaders(config) });
    if (!response.ok) {
      throw new SyncError(
        `listing r2://${config.bucket} answered ${response.status}; refusing to guess what it holds. `
        + `(url: ${redactUrl(url)})`,
      );
    }
    const body = await response.json();
    if (body.success !== true) {
      throw new SyncError(
        `listing r2://${config.bucket} reported failure: ${JSON.stringify(body.errors ?? [])}`,
      );
    }
    for (const object of body.result ?? []) if (object?.key) keys.add(object.key);
    cursor = body.result_info?.cursor || null;
    if (!cursor || (body.result ?? []).length === 0) {
      log(`bucket already holds ${keys.size} object(s)`);
      return keys;
    }
  }
  throw new SyncError('listing did not terminate after 10000 pages; refusing to continue.');
}

/** PUT over the REST API. Returns 'uploaded'; there is no 412 to return here. */
async function restPutObject(key, body, { contentType, cacheControl }, config, { fetchImpl = fetch } = {}) {
  const url = restObjectUrl(key, config);
  const response = await fetchImpl(url, {
    method: 'PUT',
    headers: restHeaders(config, { 'content-type': contentType, 'cache-control': cacheControl }),
    body,
  });
  if (!response.ok) {
    throw new SyncError(
      `PUT ${key} failed with ${response.status} ${response.statusText}. (url: ${redactUrl(url)})`,
    );
  }
  return 'uploaded';
}

/** True when the key already holds an object. Any non-200/404 is an error. */
export async function objectExists(key, config, { fetchImpl = fetch } = {}) {
  const signed = signRequest({
    method: 'HEAD',
    key,
    headers: {},
    payloadHash: sha256Hex(''),
    config,
  });
  const response = await fetchImpl(signed.url, { method: 'HEAD', headers: signed.headers });
  if (response.status === 200) return true;
  if (response.status === 404) return false;
  throw new SyncError(
    `HEAD ${key} answered ${response.status}; refusing to guess whether the object exists. `
    + `(url: ${redactUrl(signed.url)})`,
  );
}

export async function putObject(key, body, { contentType, cacheControl }, config, { fetchImpl = fetch } = {}) {
  if (config.transport === 'rest') {
    return restPutObject(key, body, { contentType, cacheControl }, config, { fetchImpl });
  }
  const signed = signRequest({
    method: 'PUT',
    key,
    headers: {
      'content-type': contentType,
      'cache-control': cacheControl,
      // Atomic create-if-absent. Two racing CI runs cannot clobber each other,
      // and an object already present is never rewritten — which matters because
      // rewriting a content-addressed object can only ever write the same bytes
      // or corrupt it.
      'if-none-match': '*',
    },
    payloadHash: sha256Hex(body),
    config,
  });
  const response = await fetchImpl(signed.url, { method: 'PUT', headers: signed.headers, body });

  // 412 means "already there" — the race we designed for, not a failure.
  if (response.status === 412) return 'exists';
  if (response.ok) return 'uploaded';
  throw new SyncError(
    `PUT ${key} failed with ${response.status} ${response.statusText}. (url: ${redactUrl(signed.url)})`,
  );
}

// --------------------------------------------------------------------------
// The sync.
// --------------------------------------------------------------------------

/**
 * Verify each asset is on disk and its bytes still hash to the manifest's value
 * BEFORE any upload. Uploading bytes whose hash disagrees with the key would put
 * an object at an address that does not describe it, which no later check could
 * detect — the key would look right forever.
 */
export function verifyAssetsOnDisk(manifest, repoRoot) {
  const failures = [];
  for (const asset of manifest.assets) {
    const absolute = resolve(repoRoot, asset.path);
    if (!existsSync(absolute)) {
      failures.push(`${asset.path}: in the manifest but not on disk`);
      continue;
    }
    const actual = sha256Of(absolute);
    const a = Buffer.from(actual, 'hex');
    const b = Buffer.from(asset.sha256, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      failures.push(
        `${asset.path}: hashes ${actual} on disk but the manifest says ${asset.sha256}. `
        + 'Regenerate: node scripts/r2-media-manifest.mjs --write',
      );
    }
  }
  return failures;
}

export async function syncManifest(manifest, repoRoot, config, {
  dryRun = false,
  concurrency = 8,
  fetchImpl = fetch,
  log = console.log,
} = {}) {
  const driftFailures = verifyAssetsOnDisk(manifest, repoRoot);
  if (driftFailures.length > 0) {
    throw new SyncError(
      `the manifest does not describe the tree; refusing to upload:\n  - ${driftFailures.join('\n  - ')}`,
      { exitCode: 2 },
    );
  }

  // One entry per DISTINCT key: two paths with identical bytes are one object.
  const byKey = new Map();
  for (const asset of manifest.assets) if (!byKey.has(asset.key)) byKey.set(asset.key, asset);
  const work = [...byKey.values()];

  const result = { total: work.length, present: 0, uploaded: 0, wouldUpload: 0, bytesUploaded: 0 };
  let cursor = 0;

  // The REST transport has no usable per-key probe (HEAD is 405, Range is
  // ignored), so it answers "already there" from one complete listing instead.
  const presentKeys = config.transport === 'rest'
    ? await listExistingKeys(config, { fetchImpl, log })
    : null;
  const alreadyPresent = async (key) => (
    presentKeys ? presentKeys.has(key) : objectExists(key, config, { fetchImpl })
  );

  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= work.length) return;
      const asset = work[index];

      if (await alreadyPresent(asset.key)) {
        result.present += 1;
        continue;
      }
      if (dryRun) {
        result.wouldUpload += 1;
        log(`would upload ${asset.key}  <- ${asset.path} (${asset.bytes} bytes)`);
        continue;
      }
      const body = readFileSync(resolve(repoRoot, asset.path));
      const outcome = await putObject(
        asset.key,
        body,
        { contentType: asset.contentType, cacheControl: manifest.cacheControl },
        config,
        { fetchImpl },
      );
      if (outcome === 'uploaded') {
        result.uploaded += 1;
        result.bytesUploaded += asset.bytes;
        log(`uploaded ${asset.key}  <- ${asset.path} (${asset.bytes} bytes)`);
      } else {
        result.present += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, work.length)) }, worker));
  return result;
}

// --------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { dryRun: false, concurrency: 8, manifest: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') options.dryRun = true;
    else if (argv[i] === '--concurrency') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1 || value > 64) {
        throw new SyncError(`--concurrency needs an integer 1..64, got ${argv[i + 1]}`, { exitCode: 2 });
      }
      options.concurrency = value;
      i += 1;
    } else if (argv[i] === '--manifest') {
      options.manifest = argv[i + 1];
      i += 1;
    } else throw new SyncError(`unknown argument: ${argv[i]}`, { exitCode: 2 });
  }
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const repoRoot = repoRootFromHere();
  const options = parseArgs(argv);
  const path = options.manifest ? resolve(options.manifest) : manifestPath(repoRoot);

  if (!existsSync(path)) {
    throw new SyncError(
      `no manifest at ${path}. Generate it: node scripts/r2-media-manifest.mjs --write`,
      { exitCode: 2 },
    );
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8'));

  // Credentials are read even for --dry-run: a dry run that "works" without
  // credentials would be a dry run that proves nothing about the real one.
  const config = readCredentials(env);

  console.log(
    `syncing ${manifest.assets.length} manifest assets to r2://${config.bucket} `
    + `${options.dryRun ? '(dry run)' : ''}`,
  );
  const result = await syncManifest(manifest, repoRoot, config, {
    dryRun: options.dryRun,
    concurrency: options.concurrency,
  });
  console.log(
    `done: ${result.total} distinct objects, ${result.present} already present, `
    + `${options.dryRun ? `${result.wouldUpload} would upload` : `${result.uploaded} uploaded (${result.bytesUploaded} bytes)`}.`,
  );
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`sync-r2-media: ${error.message}`);
    process.exit(error instanceof SyncError ? error.exitCode : 1);
  });
}
