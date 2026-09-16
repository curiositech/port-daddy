#!/usr/bin/env node
// publish-book-to-r2.mjs — mirror the just-built Book PDF to R2, so a reader
// gets the current Book from an object store with real caching and no
// dependency on the Pages deploy pipeline having also run.
//
// WHY A BOOK NEEDS SOMETHING THE REST OF THE R2 BUCKET DOES NOT.
// scripts/sync-r2-media.mjs's whole design (docs/adr/0142-r2-media-offload.md)
// rests on every key being the sha256 of its bytes: an object is immutable
// because the address IS the content, so nothing ever needs overwriting and a
// stale cached copy is a contradiction in terms. That is exactly right for
// review evidence, where an old PR body must keep linking the old bytes
// forever.
//
// The Book is the opposite kind of artifact. "Download the Book" needs to mean
// the CURRENT one, at a URL that does not change every time a chapter is
// edited -- a release pointer, not versioned evidence. So this script writes
// THREE objects, only two of which are new kinds of thing for this bucket:
//
//   book/archive/sha256/<hash>.pdf   content-addressed, immutable, exactly
//                                     ADR-0142's existing rule -- an audit
//                                     trail of every Book ever published.
//   book/current.pdf                 MUTABLE. Overwritten on every successful
//                                     publish. The bytes a reader gets from
//                                     https://media.portdaddy.dev/book/current.pdf.
//   book/current.json                MUTABLE. A few bytes describing what
//                                     current.pdf actually is (sha256, size,
//                                     page count, the source commit, when this
//                                     ran) so nothing has to download 9+ MiB
//                                     to ask "is this the build I expect".
//
// See docs/adr/0144-book-r2-mirror-with-one-mutable-pointer.md for why this one
// exception is deliberate and does not reopen ADR-0142's "no mutable keys" rule
// for anything else in the bucket -- it is two keys, both scoped under book/,
// both named "current", and nothing else in the bucket may add a third.
//
// FAIL CLOSED, same as sync-r2-media.mjs: a missing credential exits 2 before
// any network call; a PDF that is not on disk or empty exits 2 before any
// upload; a non-2xx from R2 exits 1. There is no partial-success exit code --
// a run that uploaded the archive copy but not `current.pdf` must be treated as
// a failure by whatever calls this, because a reader who lands mid-failure must
// never see a `current.pdf` and `current.json` that describe two different
// builds.
//
// Node stdlib only, reusing sync-r2-media.mjs's credential/signing primitives
// rather than re-deriving SigV4.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SyncError,
  objectExists,
  putObject,
  readCredentials,
  redactUrl,
  restObjectUrl,
  signRequest,
} from './sync-r2-media.mjs';

export const BOOK_PUBLIC_BASE_URL = 'https://media.portdaddy.dev';
export const BOOK_ARCHIVE_PREFIX = 'book/archive/sha256/';
export const BOOK_CURRENT_PDF_KEY = 'book/current.pdf';
export const BOOK_CURRENT_MANIFEST_KEY = 'book/current.json';
export const BOOK_CACHE_CONTROL_ARCHIVE = 'public, max-age=31536000, immutable';
// The pointer must revalidate quickly: it changes on every publish and a
// year-long immutable cache would mean a reader who fetched it yesterday keeps
// getting yesterday's Book. `no-cache` still lets Cloudflare's edge cache the
// bytes -- it only forces a revalidation round-trip, which is the cost of
// pointing a fixed URL at content that legitimately changes.
export const BOOK_CACHE_CONTROL_CURRENT = 'public, no-cache';

export function archiveKeyFor(sha256Hex) {
  return `${BOOK_ARCHIVE_PREFIX}${sha256Hex}.pdf`;
}

function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Overwrite-capable PUT. Distinct from sync-r2-media.mjs's putObject(): that
 * function's `if-none-match: *` is a deliberate immutability guarantee for the
 * content-addressed media bucket, and reusing it here would silently make
 * `book/current.pdf` un-overwritable the first time it was ever written. This
 * is the one place in the codebase that intentionally clobbers an R2 object.
 */
export async function putObjectOverwrite(key, body, { contentType, cacheControl }, config, { fetchImpl = fetch } = {}) {
  if (config.transport === 'rest') {
    const url = restObjectUrl(key, config);
    const response = await fetchImpl(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.apiToken}`,
        'content-type': contentType,
        'cache-control': cacheControl,
      },
      body,
    });
    if (!response.ok) {
      throw new SyncError(`PUT ${key} failed with ${response.status} ${response.statusText}. (url: ${redactUrl(url)})`);
    }
    return;
  }
  const signed = signRequest({
    method: 'PUT',
    key,
    headers: { 'content-type': contentType, 'cache-control': cacheControl },
    payloadHash: sha256Of(body),
    config,
  });
  const response = await fetchImpl(signed.url, { method: 'PUT', headers: signed.headers, body });
  if (!response.ok) {
    throw new SyncError(`PUT ${key} failed with ${response.status} ${response.statusText}. (url: ${redactUrl(signed.url)})`);
  }
}

/**
 * Build the small "what is current.pdf" record. Pure function so its shape is
 * directly testable without a network.
 */
export function buildCurrentManifest({ sha256Hex, bytes, pages, sourceCommit, publishedAt }) {
  return {
    $comment: 'GENERATED by scripts/publish-book-to-r2.mjs on every successful Book publish. Do not hand-edit.',
    sha256: sha256Hex,
    bytes,
    pages: pages ?? null,
    sourceCommit: sourceCommit ?? null,
    publishedAt,
    archiveUrl: `${BOOK_PUBLIC_BASE_URL}/${archiveKeyFor(sha256Hex)}`,
    currentUrl: `${BOOK_PUBLIC_BASE_URL}/${BOOK_CURRENT_PDF_KEY}`,
  };
}

/**
 * Publish one Book PDF to R2: the immutable archive copy (skipped if that
 * exact sha256 was already archived by a previous run), then both mutable
 * pointer objects, in that order -- so a failure between them never leaves
 * `current.json` describing bytes that never made it to `current.pdf`, only
 * the reverse (a `current.pdf` briefly ahead of its own manifest, corrected by
 * the very next successful run).
 */
export async function publishBook(pdfBytes, { pages, sourceCommit, config, now = () => new Date(), fetchImpl = fetch, log = () => {} }) {
  if (!pdfBytes || pdfBytes.length === 0) {
    throw new SyncError('refusing to publish an empty Book PDF', { exitCode: 2 });
  }
  const sha256Hex = sha256Of(pdfBytes);
  const archiveKey = archiveKeyFor(sha256Hex);

  // REST has no cheap per-key probe (HEAD is 405 there — see sync-r2-media.mjs's
  // own note on the transport), and listing the whole bucket to answer one key
  // would cost more than just re-sending the bytes. So on REST this always
  // re-PUTs the archive copy: one extra ~9 MiB upload per publish, accepted
  // because it only runs on push/workflow_dispatch (not every PR), and PUTting
  // bytes that already match the content-addressed key is a safe no-op, not a
  // correctness risk.
  const alreadyArchived = config.transport === 'rest'
    ? false
    : await objectExists(archiveKey, config, { fetchImpl });
  if (alreadyArchived) {
    log(`archive already holds ${archiveKey} — skipping upload, still refreshing the pointer`);
  } else {
    await putObject(
      archiveKey,
      pdfBytes,
      { contentType: 'application/pdf', cacheControl: BOOK_CACHE_CONTROL_ARCHIVE },
      config,
      { fetchImpl },
    );
    log(`archived ${archiveKey} (${pdfBytes.length} bytes)`);
  }

  const manifest = buildCurrentManifest({
    sha256Hex,
    bytes: pdfBytes.length,
    pages,
    sourceCommit,
    publishedAt: now().toISOString(),
  });

  await putObjectOverwrite(
    BOOK_CURRENT_PDF_KEY,
    pdfBytes,
    { contentType: 'application/pdf', cacheControl: BOOK_CACHE_CONTROL_CURRENT },
    config,
    { fetchImpl },
  );
  log(`updated ${BOOK_CURRENT_PDF_KEY}`);

  await putObjectOverwrite(
    BOOK_CURRENT_MANIFEST_KEY,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
    { contentType: 'application/json', cacheControl: BOOK_CACHE_CONTROL_CURRENT },
    config,
    { fetchImpl },
  );
  log(`updated ${BOOK_CURRENT_MANIFEST_KEY}`);

  return manifest;
}

function parseArgs(argv) {
  const options = { pdfPath: null, pages: null, sourceCommit: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--pages') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new SyncError(`--pages needs a positive integer, got ${argv[i + 1]}`, { exitCode: 2 });
      }
      options.pages = value;
      i += 1;
    } else if (argv[i] === '--source-commit') {
      options.sourceCommit = argv[i + 1];
      i += 1;
    } else if (!options.pdfPath && !argv[i].startsWith('--')) {
      options.pdfPath = argv[i];
    } else {
      throw new SyncError(`unknown argument: ${argv[i]}`, { exitCode: 2 });
    }
  }
  if (!options.pdfPath) {
    throw new SyncError('usage: publish-book-to-r2.mjs <path-to-book.pdf> [--pages N] [--source-commit SHA]', { exitCode: 2 });
  }
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const absolute = resolve(options.pdfPath);
  if (!existsSync(absolute)) {
    throw new SyncError(`no file at ${absolute}`, { exitCode: 2 });
  }
  const pdfBytes = readFileSync(absolute);

  // Credentials are read before anything else -- a missing secret must fail
  // before the (cheap but real) sha256 pass, exactly like sync-r2-media.mjs.
  const config = readCredentials(env);

  console.log(`publishing ${absolute} (${pdfBytes.length} bytes) to r2://${config.bucket}/book/`);
  const manifest = await publishBook(pdfBytes, {
    pages: options.pages,
    sourceCommit: options.sourceCommit,
    config,
    log: console.log,
  });
  console.log(`done: ${manifest.currentUrl} is now sha256:${manifest.sha256} (${manifest.bytes} bytes)`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`publish-book-to-r2: ${error.message}`);
    process.exit(error instanceof SyncError ? error.exitCode : 1);
  });
}
