#!/usr/bin/env node
// Prove that every file ADR-0142 Phase 2 removed from git is still readable by
// the public, over https://media.portdaddy.dev, RIGHT NOW.
//
// THIS CHECK NEEDS NO CREDENTIALS. That is the entire point of it, and it is
// why it can be required on a fork PR and run on a contributor's laptop.
//
// The brief this was written against put it plainly: a check that silently
// passes when credentials are absent is worse than no check. There were two
// ways to satisfy that, and this repository can have the better one:
//
//   - skip loudly when a secret is missing, or
//   - ask a question whose answer needs no secret.
//
// A custom domain on a public bucket makes the second available, so that is
// what this does. It never reads CLOUDFLARE_API_TOKEN, R2_ACCESS_KEY_ID or any
// other secret -- it makes the same anonymous GET a reader of a two-year-old PR
// makes. If that GET fails, the repository's prose is pointing at bytes the
// public cannot fetch, which is exactly the failure Phase 2 introduces and
// exactly the one nothing else would catch.
//
// IT VERIFIES BYTES, NOT STATUS. A 200 proves something answered; it does not
// prove the right object answered. Each entry's key IS the sha256 of its bytes,
// so the response body is hashed and compared to the key. That also catches the
// one failure mode the S3-less REST upload path cannot prevent (see
// scripts/sync-r2-media.mjs): a PUT that overwrote a key with different bytes.
//
// IT READS THE ORIGIN WHEN IT MATTERS. Objects are served
// `immutable, max-age=31536000`, so a clobbered object keeps serving the OLD
// cached bytes from the edge for up to a year. A cache HIT that matches is
// therefore good news about the edge and says nothing about the origin; --origin
// adds a cache-busting query string so the check reaches past it.
//
// Usage:
//   node scripts/verify-r2-public-reads.mjs            # every entry
//   node scripts/verify-r2-public-reads.mjs --sample 25
//   node scripts/verify-r2-public-reads.mjs --origin   # bypass the edge cache

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRootFromHere } from './r2-media-manifest.mjs';
import { OFFLOADED_PATH } from './r2-offload-move.mjs';

export class VerifyError extends Error {
  constructor(message, { exitCode = 1 } = {}) {
    super(message);
    this.name = 'VerifyError';
    this.exitCode = exitCode;
  }
}

/**
 * Check one entry. Returns a failure string, or null.
 *
 * Deliberately strict about content-type: these URLs are pasted into PR bodies
 * and markdown, where a wrong type renders as a download prompt instead of an
 * image, which looks exactly like "the evidence is missing".
 */
export async function verifyEntry(entry, { fetchImpl = fetch, origin = false } = {}) {
  const url = origin ? `${entry.url}?cachebust=${entry.sha256.slice(0, 16)}` : entry.url;
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'follow' });
  } catch (error) {
    return `${entry.path}: GET ${entry.url} could not be completed (${error.message}).`;
  }
  if (response.status !== 200) {
    return `${entry.path}: GET ${entry.url} answered ${response.status}, expected 200. `
      + 'The repository points at this URL and the public cannot read it.';
  }
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
  if (type !== entry.contentType) {
    return `${entry.path}: served as '${type}', the manifest says '${entry.contentType}'.`;
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== entry.bytes) {
    return `${entry.path}: served ${body.length} bytes, expected ${entry.bytes}.`;
  }
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== entry.sha256) {
    return `${entry.path}: served bytes hash ${actual}, but the key says ${entry.sha256}. `
      + 'The object at this address does not describe itself -- it was overwritten.';
  }
  return null;
}

export async function verifyAll(entries, { fetchImpl = fetch, concurrency = 8, origin = false, log = console.log } = {}) {
  const failures = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= entries.length) return;
      const failure = await verifyEntry(entries[index], { fetchImpl, origin });
      done += 1;
      if (failure) failures.push(failure);
      if (done % 25 === 0) log(`  ${done}/${entries.length} checked`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, entries.length || 1)) }, worker));
  return failures;
}

export async function main(argv = process.argv.slice(2)) {
  let sample = 0;
  let origin = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sample') { sample = Number(argv[i + 1]); i += 1; } else if (argv[i] === '--origin') origin = true;
    else throw new VerifyError(`unknown argument: ${argv[i]}`, { exitCode: 2 });
  }

  const repoRoot = repoRootFromHere();
  const file = join(repoRoot, OFFLOADED_PATH);
  if (!existsSync(file)) {
    // Nothing has been offloaded yet. That is a real, passing state -- but it is
    // announced, because "there is nothing to check" and "the check did not run"
    // must never look the same in a log.
    console.log(`${OFFLOADED_PATH} does not exist: no file has been moved out of git yet, `
      + 'so there is nothing for this check to verify. Passing.');
    return { checked: 0, failures: 0 };
  }
  const offloaded = JSON.parse(readFileSync(file, 'utf8'));
  let entries = offloaded.entries ?? [];
  if (entries.length === 0) {
    console.log(`${OFFLOADED_PATH} lists no entries. Passing.`);
    return { checked: 0, failures: 0 };
  }

  // A sample is a deterministic slice, not a random one: a check that tests a
  // different subset each run reports flaky failures and hides steady ones.
  if (sample > 0 && sample < entries.length) {
    const step = entries.length / sample;
    entries = Array.from({ length: sample }, (_, i) => entries[Math.floor(i * step)]);
  }

  console.log(`verifying ${entries.length} public read(s) over ${offloaded.publicBase} `
    + `with no credentials${origin ? ', bypassing the edge cache' : ''}...`);
  const failures = await verifyAll(entries, { origin });

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    throw new VerifyError(
      `${failures.length} of ${entries.length} offloaded object(s) are not publicly readable as described. `
      + 'These files are no longer in git, so this is the only thing standing between the '
      + 'repository and a permanently broken reference.',
    );
  }
  console.log(`all ${entries.length} offloaded object(s) are publicly readable, `
    + 'correctly typed, and hash to their content address.');
  return { checked: entries.length, failures: 0 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`verify-r2-public-reads: ${error.message}`);
    process.exit(error instanceof VerifyError ? error.exitCode : 1);
  });
}
