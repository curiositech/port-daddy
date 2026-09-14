#!/usr/bin/env node
// The one authority for "which media lives in R2, and under what key".
//
// THE RULE THIS REPO KEEPS BREAKING. A manifest and a tree that must agree,
// with neither deriving from the other, is two sources of truth wearing one
// hat; whichever one a change forgets, nothing notices. `whitepaper/corpus.json`
// answers that by *discovering* every on-disk formal artifact and failing when
// the manifest does not cover it. ADR-0130 states the general form: a file whose
// true source of truth is "the current state of many other files" is GENERATED
// and hash-gated, never hand-merged — `scripts/adr-number-collision-guard.mjs
// --write-registry` is the worked example.
//
// `media/r2-manifest.json` is that kind of file. It is a pure projection of the
// git tree under the offload roots below. Nobody hand-edits it; nobody hand-adds
// a path to it. `--write` regenerates it, `scripts/check-r2-media-manifest.mjs`
// regenerates it in-process and fails if the committed bytes differ. There is
// exactly one authority — the tree — and the manifest is its cache.
//
// THE OFFLOAD RULE IS MECHANICAL. A file is offloaded when, and only when,
//
//     git tracks it
//     AND its extension is in MEDIA_EXTENSIONS
//     AND its path starts with one of OFFLOAD_ROOTS
//
// No size threshold, no per-file judgement, no exception list. "Is this
// screenshot big enough to be worth it?" is exactly the question that produces a
// list somebody has to maintain. See docs/adr/0141-r2-media-offload.md for why
// these roots and not others: every one of them holds review evidence that no
// build step reads. Adding a root is an ADR-sized decision, not a line edit.
//
// Node stdlib only — this runs in CI with no install step, like every other
// checker in this directory.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_VERSION = 1;

/**
 * Roots whose media is review evidence: screenshots, recordings and captures
 * attached to a PR or a report, read by humans following a link and by no build
 * step. Verified with a reference scan at authoring time — the only build-script
 * mentions of these paths are scripts that WRITE evidence into them
 * (`check-mcp-a11y.mjs`, `capture-roadmap-*.ts`) or that cite a `.md` file, never
 * one that reads an image out of them.
 *
 * Deliberately NOT here, and why:
 *   website-v2/public/   — vite copies it into `dist` at build time; an
 *                          unreachable R2 would break the BUILD, not just a
 *                          stale link. Build inputs stay in git. (ADR-0141 §5.)
 *   whitepaper/…/plates/ — `\includegraphics` resolves these during pdflatex.
 *                          Same reason, louder: a missing plate fails the book
 *                          ~20 minutes into a LaTeX run.
 *   core/pd-console/     — fixtures some tests read.
 */
export const OFFLOAD_ROOTS = Object.freeze([
  '.github/assets/',
  'docs/artifacts/',
  'docs/pr-assets/',
  'docs/pr-media/',
  'docs/reports/',
  'fleet-config-ui/docs/',
  'website-v2/docs/',
  'website-v2/screenshots/',
]);

/** Raster/video/document media. Not `.svg`: it is text, diffs, and is tiny. */
export const MEDIA_EXTENSIONS = Object.freeze([
  '.gif', '.jpeg', '.jpg', '.mov', '.mp4', '.pdf', '.png', '.tiff', '.webm', '.webp',
]);

const EXTENSION_SET = new Set(MEDIA_EXTENSIONS);
const ROOT_LIST = [...OFFLOAD_ROOTS];

/** The mechanical rule, in one place, with no arguments but the path. */
export function isOffloadable(repoRelativePath) {
  if (!EXTENSION_SET.has(extname(repoRelativePath).toLowerCase())) return false;
  return ROOT_LIST.some((root) => repoRelativePath.startsWith(root));
}

/**
 * Content address. The key IS the hash, so the same bytes always land on the
 * same key: re-running the sync after a rebuild that produced identical files
 * uploads nothing, and two paths holding the same screenshot share one object.
 * The extension is kept on the end so the browser and R2 agree on a Content-Type
 * and a direct link downloads with a sensible name.
 */
export function objectKeyFor(sha256, repoRelativePath) {
  return `sha256/${sha256.slice(0, 2)}/${sha256}${extname(repoRelativePath).toLowerCase()}`;
}

export function sha256Of(absolutePath) {
  return createHash('sha256').update(readFileSync(absolutePath)).digest('hex');
}

const CONTENT_TYPES = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.tiff': 'image/tiff',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
};

export function contentTypeFor(repoRelativePath) {
  return CONTENT_TYPES[extname(repoRelativePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Content-addressed keys are immutable by construction — the bytes at a key can
 * never change, because changing the bytes changes the key. That is exactly the
 * precondition `immutable` asks for, so a year is safe and a revalidation
 * request is never needed.
 */
export const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function trackedFiles(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

/**
 * Regenerate the manifest from the tree. This is the ONLY function that decides
 * what the manifest contains; `--write` and the checker both call it, so they
 * cannot disagree about the answer.
 */
export function buildManifest(repoRoot, { files = null } = {}) {
  const candidates = (files ?? trackedFiles(repoRoot)).filter(isOffloadable).sort();

  const assets = [];
  for (const path of candidates) {
    const absolute = resolve(repoRoot, path);
    let stats;
    try {
      stats = statSync(absolute);
    } catch {
      // `git ls-files` lists a path that is not on disk during a partial
      // checkout or an interrupted LFS smudge. Regenerating the manifest from a
      // tree we cannot read would silently DROP assets, so refuse instead.
      throw new Error(
        `r2-media-manifest: ${path} is tracked but not readable on disk. `
        + 'Refusing to regenerate a manifest from an incomplete checkout.',
      );
    }
    if (!stats.isFile()) continue;
    const sha256 = sha256Of(absolute);
    assets.push({
      path,
      bytes: stats.size,
      sha256,
      key: objectKeyFor(sha256, path),
      contentType: contentTypeFor(path),
    });
  }

  // Two paths holding identical bytes share one key and therefore one upload;
  // `distinctObjects`/`distinctBytes` are what R2 actually stores.
  const bytesByKey = new Map(assets.map((asset) => [asset.key, asset.bytes]));
  return {
    $comment:
      'GENERATED by scripts/r2-media-manifest.mjs --write. Do not hand-edit: it is a '
      + 'projection of the git tree, and scripts/check-r2-media-manifest.mjs fails on any '
      + 'byte of drift. To change what is here, change the tree or the rule in that script.',
    version: MANIFEST_VERSION,
    generatedBy: 'scripts/r2-media-manifest.mjs --write',
    bucket: 'port-daddy-media',
    publicBase: 'https://media.portdaddy.dev',
    cacheControl: CACHE_CONTROL,
    rule: {
      offloadRoots: ROOT_LIST,
      mediaExtensions: [...MEDIA_EXTENSIONS],
      note: 'tracked by git AND extension in mediaExtensions AND path under an offloadRoot. No size threshold, no exceptions.',
    },
    counts: {
      assets: assets.length,
      distinctObjects: bytesByKey.size,
      bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
      distinctBytes: [...bytesByKey.values()].reduce((sum, bytes) => sum + bytes, 0),
    },
    assets,
  };
}

/** Deterministic bytes: same tree in, same file out, on every platform. */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function manifestPath(repoRoot) {
  return resolve(repoRoot, 'media/r2-manifest.json');
}

export function repoRootFromHere() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = repoRootFromHere();
  if (!process.argv.includes('--write')) {
    console.error('usage: node scripts/r2-media-manifest.mjs --write');
    console.error('  (to verify instead, run: node scripts/check-r2-media-manifest.mjs)');
    process.exit(2);
  }
  const manifest = buildManifest(repoRoot);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(dirname(manifestPath(repoRoot)), { recursive: true });
  writeFileSync(manifestPath(repoRoot), serializeManifest(manifest));
  console.log(
    `wrote media/r2-manifest.json: ${manifest.counts.assets} assets, `
    + `${manifest.counts.distinctObjects} distinct objects, `
    + `${(manifest.counts.bytes / 1024 / 1024).toFixed(1)} MiB `
    + `(${(manifest.counts.distinctBytes / 1024 / 1024).toFixed(1)} MiB after de-duplication).`,
  );
}
