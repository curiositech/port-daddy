#!/usr/bin/env node
// Drift check for media/r2-manifest.json.
//
// WHAT MAKES THIS DIFFERENT FROM THE CHECKS THIS REPO KEEPS BREAKING. The
// recurring bug is two lists that must agree with nothing deriving either from
// the other — a checker that only asks "does list A match list B" passes happily
// while both are wrong together, which is precisely how
// `prune-pages-assets.mjs` kept the Book PDF out of production for months while
// its test stayed green. (That test asserted the exclusion list contained the
// PDF. It did. The PDF was 9.29 MiB against a 25 MiB limit, and nothing checked
// THAT.)
//
// Here the manifest is not a second list. It is a projection of the git tree,
// and this checker regenerates it from that tree in-process and compares bytes.
// There is nothing to keep in sync by hand: a new screenshot under an offload
// root fails the check until the manifest is regenerated, a deleted one fails it
// the same way, and an edited image fails it because its sha256 — and therefore
// its key — moved. The tree is the authority; the committed file is a cache of
// the answer; this job is the cache-coherence test.
//
// Same regenerate-and-diff shape as `scripts/adr-number-collision-guard.mjs
// --write-registry`, which ADR-0130 names as the worked example.
//
// Exit 0 clean, 1 on drift. Node stdlib only.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildManifest,
  manifestPath,
  repoRootFromHere,
  serializeManifest,
} from './r2-media-manifest.mjs';

export function diffManifests(committed, regenerated) {
  const failures = [];

  const committedByPath = new Map((committed.assets ?? []).map((a) => [a.path, a]));
  const regeneratedByPath = new Map(regenerated.assets.map((a) => [a.path, a]));

  for (const [path, asset] of regeneratedByPath) {
    const found = committedByPath.get(path);
    if (!found) {
      failures.push(
        `on-disk asset not in the manifest: ${path} (${asset.bytes} bytes). `
        + 'It matches the offload rule, so it must be listed and uploaded.',
      );
      continue;
    }
    if (found.sha256 !== asset.sha256) {
      failures.push(
        `content drift: ${path} hashes ${asset.sha256} on disk but the manifest records `
        + `${found.sha256}. The bytes changed, so the object key changed too.`,
      );
    }
    if (found.bytes !== asset.bytes) {
      failures.push(`size drift: ${path} is ${asset.bytes} bytes on disk, manifest says ${found.bytes}.`);
    }
    if (found.key !== asset.key) {
      failures.push(`key drift: ${path} addresses ${asset.key}, manifest says ${found.key}.`);
    }
    if (found.contentType !== asset.contentType) {
      failures.push(
        `content-type drift: ${path} is served as ${asset.contentType}, manifest says ${found.contentType}.`,
      );
    }
  }

  for (const path of committedByPath.keys()) {
    if (!regeneratedByPath.has(path)) {
      failures.push(
        `manifest lists ${path}, which is not a tracked file matching the offload rule `
        + '(deleted, renamed, moved out of an offload root, or a hand-added entry).',
      );
    }
  }

  return failures;
}

export function checkManifest(repoRoot) {
  const path = manifestPath(repoRoot);
  const regenerated = buildManifest(repoRoot);

  if (!existsSync(path)) {
    return {
      failures: [
        'media/r2-manifest.json does not exist. Generate it: node scripts/r2-media-manifest.mjs --write',
      ],
      regenerated,
    };
  }

  const rawCommitted = readFileSync(path, 'utf8');
  let committed;
  try {
    committed = JSON.parse(rawCommitted);
  } catch (error) {
    return { failures: [`media/r2-manifest.json is not valid JSON (${error.message})`], regenerated };
  }

  const failures = diffManifests(committed, regenerated);

  // Byte comparison last, so the semantic failures above explain WHY when both
  // fire. A byte difference with no semantic difference means a field outside
  // `assets` moved — a counts line, the bucket name, the cache-control string —
  // and that is drift too: the file is supposed to be exactly what regeneration
  // produces.
  if (rawCommitted !== serializeManifest(regenerated)) {
    failures.push(
      'media/r2-manifest.json does not match what regeneration produces right now. '
      + 'Do not hand-resolve it: regenerate with `node scripts/r2-media-manifest.mjs --write`.',
    );
  }

  return { failures, regenerated };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = repoRootFromHere();
  const { failures, regenerated } = checkManifest(repoRoot);

  for (const failure of failures) console.error(`FAIL: ${failure}`);

  if (failures.length > 0) {
    console.error(
      `\nR2 media manifest check failed with ${failures.length} problem(s). `
      + 'Fix: node scripts/r2-media-manifest.mjs --write',
    );
    process.exit(1);
  }

  console.log(
    `R2 media manifest check passed: ${regenerated.counts.assets} assets, `
    + `${regenerated.counts.distinctObjects} distinct objects, `
    + `${(regenerated.counts.bytes / 1024 / 1024).toFixed(1)} MiB, manifest matches the tree byte-for-byte.`,
  );
}
