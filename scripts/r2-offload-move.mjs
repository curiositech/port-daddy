#!/usr/bin/env node
// Phase 2 of ADR-0142: take one offload root OUT of git and leave it in R2.
//
// WHY THIS IS A SEPARATE FILE FROM THE MANIFEST, AND THE GAP IT CLOSES.
//
// media/r2-manifest.json is a projection of the git tree. That is its whole
// virtue (ADR-0142 §10) and, at Phase 2, its whole problem: the moment a file
// stops being tracked it stops being in the manifest, so the manifest stops
// saying anything about it. Remove 113 files from git and the drift checker
// goes on passing while every one of their URLs could be 404 and nothing would
// notice. The tree cannot be the authority for files that are deliberately not
// in the tree.
//
// So a move writes a SECOND record, media/r2-offloaded.json, which is the
// authority for exactly the files git no longer has: their bytes' sha256, the
// content-addressed key, and the URL the repository now points at. That file is
// append-only by construction -- a path enters it when it leaves git and is
// never rewritten, because the bytes it describes can never change (the key is
// the hash).
//
// scripts/verify-r2-public-reads.mjs reads it and fetches every URL over
// https://media.portdaddy.dev with NO CREDENTIALS AT ALL, which is why the
// Phase 2 check can run on a fork PR, on a contributor's laptop, and in a CI
// job that holds no secrets. See ADR-0142 §11.1.
//
// Usage:
//   node scripts/r2-offload-move.mjs --root docs/pr-assets/ [--root ...] [--dry-run]
//
// It refuses to move a file that anything other than prose points at, and it
// rewrites every prose reference it does move. Both halves are non-optional.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OFFLOAD_ROOTS, isOffloadable, objectKeyFor, contentTypeFor,
  sha256Of, repoRootFromHere, trackedFiles,
} from './r2-media-manifest.mjs';

export const OFFLOADED_PATH = 'media/r2-offloaded.json';
export const PUBLIC_BASE = 'https://media.portdaddy.dev';

/** Extensions whose contents are prose we are willing to rewrite in place. */
const PROSE = new Set(['.md', '.mdx']);

/** A referrer that is not prose means the file is an input to something. */
export function classifyReferrer(file) {
  if (file === OFFLOADED_PATH || file === 'media/r2-manifest.json') return 'derived';
  const dot = file.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.slice(dot).toLowerCase();
  if (PROSE.has(ext)) return 'prose';
  return 'consumer';
}

/**
 * Every tracked text file that names `basename`, with its classification.
 *
 * Basename matching is deliberately WIDER than the reference actually written:
 * a false positive costs us a file we decline to move, a false negative costs
 * us a broken link in the tree. The asymmetry is the whole reason it is a
 * basename scan and not a link parser.
 */
export function findReferrers(repoRoot, names, files) {
  const hits = new Map();           // basename -> Map(file -> kind)
  for (const n of names) hits.set(n, new Map());
  if (names.size === 0) return hits;
  const pattern = new RegExp([...names].sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

  for (const file of files) {
    let text;
    try { text = readFileSync(join(repoRoot, file), 'utf8'); } catch { continue; }
    if (!text.includes('.')) continue;
    for (const match of text.matchAll(pattern)) {
      hits.get(match[0]).set(file, classifyReferrer(file));
    }
  }
  return hits;
}

/** Rewrite every occurrence of a relative link to `asset` into its R2 URL. */
export function rewriteProse(text, proseFile, assetPath, url) {
  const rel = relative(dirname(proseFile), assetPath);
  const candidates = [
    assetPath, `/${assetPath}`, `./${assetPath}`, rel, `./${rel}`,
  ];
  let out = text;
  for (const candidate of [...new Set(candidates)].sort((a, b) => b.length - a.length)) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // A candidate can appear as the TAIL of an absolute URL that already
    // pins a different host and commit -- a `raw.githubusercontent.com/...`
    // link, most often, since this repo's "two SHAs" manifests point one at
    // the figure-source commit and one at the asset-only commit. Replacing
    // only the trailing path there would leave the old host+commit prefix in
    // place and splice `url` directly onto the end of it, producing one
    // string that is two concatenated URLs with no separator. So the WHOLE
    // enclosing URL is matched and replaced first; whatever candidate
    // occurrences are left afterwards are bare paths, not URL tails, and the
    // plain split/join below is correct for those.
    const enclosingUrl = new RegExp(`https?://[^\\s\`"'()<>[\\]]*?${escaped}`, 'g');
    out = out.replace(enclosingUrl, url);
    out = out.split(candidate).join(url);
  }
  return out;
}

export function planMove(repoRoot, roots, { files = null } = {}) {
  for (const root of roots) {
    if (!OFFLOAD_ROOTS.includes(root)) {
      throw new Error(
        `${root} is not an ADR-0142 offload root. Adding one is an ADR amendment `
        + `with its own reference scan, not a flag on this command (§2.1).`,
      );
    }
  }
  const tracked = files ?? trackedFiles(repoRoot);
  const subject = tracked.filter((f) => isOffloadable(f) && roots.some((r) => f.startsWith(r)));
  const textFiles = tracked.filter((f) => !isOffloadable(f));
  const referrers = findReferrers(repoRoot, new Set(subject.map((f) => basename(f))), textFiles);

  const move = [];
  const refused = [];
  for (const path of subject.sort()) {
    const hits = referrers.get(basename(path)) ?? new Map();
    const consumers = [...hits].filter(([, kind]) => kind === 'consumer').map(([f]) => f);
    if (consumers.length > 0) {
      refused.push({ path, consumers });
      continue;
    }
    const sha256 = sha256Of(join(repoRoot, path));
    const key = objectKeyFor(sha256, path);
    move.push({
      path,
      sha256,
      key,
      bytes: readFileSync(join(repoRoot, path)).length,
      contentType: contentTypeFor(path),
      url: `${PUBLIC_BASE}/${key}`,
      prose: [...hits].filter(([, kind]) => kind === 'prose').map(([f]) => f).sort(),
    });
  }
  return { move, refused };
}

function loadOffloaded(repoRoot) {
  const file = join(repoRoot, OFFLOADED_PATH);
  if (!existsSync(file)) {
    return {
      $comment: 'GENERATED by scripts/r2-offload-move.mjs. The authority for files that '
        + 'ADR-0142 Phase 2 removed from git and that now exist ONLY in R2. Append-only: an '
        + 'entry describes immutable bytes at a content-addressed key, so it is never edited. '
        + 'scripts/verify-r2-public-reads.mjs fetches every url here with no credentials.',
      version: 1,
      publicBase: PUBLIC_BASE,
      entries: [],
    };
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function main(argv = process.argv.slice(2)) {
  const roots = [];
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root') { roots.push(argv[i + 1]); i += 1; } else if (argv[i] === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (roots.length === 0) throw new Error('give at least one --root');

  const repoRoot = repoRootFromHere();
  const { move, refused } = planMove(repoRoot, roots);

  for (const r of refused) {
    console.log(`refusing ${r.path}: read by ${r.consumers.slice(0, 3).join(', ')}`);
  }
  if (move.length === 0) {
    console.log('nothing to move.');
    return { moved: 0, rewritten: 0, refused: refused.length };
  }

  // Rewrite prose first: a link must never point at a file that is already gone,
  // not even for the duration of this process.
  const edits = new Map();
  for (const asset of move) {
    for (const file of asset.prose) {
      const current = edits.get(file) ?? readFileSync(join(repoRoot, file), 'utf8');
      edits.set(file, rewriteProse(current, file, asset.path, asset.url));
    }
  }

  const bytes = move.reduce((n, a) => n + a.bytes, 0);
  if (dryRun) {
    console.log(`would move ${move.length} file(s), ${(bytes / 1048576).toFixed(1)} MiB, `
      + `rewriting ${edits.size} prose file(s); ${refused.length} refused.`);
    return { moved: move.length, rewritten: edits.size, refused: refused.length, bytes };
  }

  for (const [file, text] of edits) writeFileSync(join(repoRoot, file), text);

  const offloaded = loadOffloaded(repoRoot);
  const known = new Set(offloaded.entries.map((e) => e.path));
  for (const asset of move) {
    if (known.has(asset.path)) continue;
    offloaded.entries.push({
      path: asset.path,
      sha256: asset.sha256,
      key: asset.key,
      bytes: asset.bytes,
      contentType: asset.contentType,
      url: asset.url,
    });
  }
  offloaded.entries.sort((a, b) => (a.path < b.path ? -1 : 1));
  offloaded.counts = {
    entries: offloaded.entries.length,
    bytes: offloaded.entries.reduce((n, e) => n + e.bytes, 0),
  };
  writeFileSync(join(repoRoot, OFFLOADED_PATH), `${JSON.stringify(offloaded, null, 2)}\n`);

  // git rm LAST, so a crash anywhere above leaves the tree consistent.
  for (let i = 0; i < move.length; i += 50) {
    execFileSync('git', ['-C', repoRoot, 'rm', '--quiet', '--', ...move.slice(i, i + 50).map((a) => a.path)]);
  }

  console.log(`moved ${move.length} file(s), ${(bytes / 1048576).toFixed(1)} MiB out of git; `
    + `rewrote ${edits.size} prose file(s); ${refused.length} refused; `
    + `${OFFLOADED_PATH} now lists ${offloaded.entries.length}.`);
  return { moved: move.length, rewritten: edits.size, refused: refused.length, bytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (error) { console.error(`r2-offload-move: ${error.message}`); process.exit(1); }
}
