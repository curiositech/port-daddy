#!/usr/bin/env node
/**
 * doc-retirement-guard.mjs — fail-closed gate on retired-document banners.
 *
 * Why this exists: a superseded plan that still reads as current is worse than
 * a missing one, because an agent that finds it follows it. `docs/recovery/`
 * asserted "if a roadmap ... elsewhere disagrees with this directory, this
 * directory wins" for four months after it stopped being true, and `V4-DAG.md`
 * presented a critical path through a node ADR-0049 had already rejected.
 * ADR-0126 retired both. Nothing stopped them drifting back.
 *
 * THE INVARIANT (both directions, which is the point):
 *
 *   1. Every path in the manifest exists, carries a `RETIRED-BY: ADR-NNNN`
 *      marker near the top, and that ADR is a real live file in docs/adr/.
 *   2. Every file carrying a RETIRED-BY marker appears in the manifest.
 *
 * Direction 1 alone would be satisfied by never retiring anything. Direction 2
 * is what catches a banner pasted onto a doc without registering it, so the
 * manifest cannot silently fall behind the tree.
 *
 * The marker must sit within the first MARKER_WINDOW lines: a retirement notice
 * below the fold is not a notice. The banner PROSE is deliberately unchecked —
 * judging whether wording is honest is the technology-solutionism anti-pattern
 * `check-doc-citations.mjs` names. This checks structure only.
 *
 * Retirement is demotion, never deletion (the 2026-06-05 operator rule: delete
 * only a merged twin), so a manifest entry naming a missing file is an error,
 * not a pass.
 *
 * Modes:
 *   node scripts/doc-retirement-guard.mjs            # check the whole corpus
 *   node scripts/doc-retirement-guard.mjs --json     # machine-readable
 *   node scripts/doc-retirement-guard.mjs --manifest <path>   # test harness
 *   node scripts/doc-retirement-guard.mjs --root <dir>        # test harness
 *
 * Exit codes: 0 = clean, 1 = a violation, 2 = cannot determine.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep, normalize } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const JSON_OUT = argv.includes('--json');
const REPO = resolve(flag('--root') ?? join(HERE, '..'));
const MANIFEST_PATH = resolve(flag('--manifest') ?? join(REPO, 'docs', 'retirement-manifest.json'));

/** The structured marker. Owned by us, not a content heuristic. */
const MARKER = /(?:^|\n)[^\n]{0,8}RETIRED-BY:\s*ADR-(\d{4})/;
const MARKER_WINDOW = 40;

/** Directories never worth walking for markers. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'target']);
/** Extensions that can carry a banner. */
const SCANNED = ['.md', '.yaml', '.yml'];

const errors = [];
const fail = (msg) => errors.push(msg);

if (!existsSync(MANIFEST_PATH)) {
  process.stderr.write(`doc-retirement-guard: no manifest at ${MANIFEST_PATH}\n`);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (e) {
  process.stderr.write(`doc-retirement-guard: manifest is not valid JSON — ${e.message}\n`);
  process.exit(2);
}

const entries = manifest.retired ?? {};

/** Read the first MARKER_WINDOW lines and return the ADR number a marker names. */
function markerIn(absPath) {
  const head = readFileSync(absPath, 'utf8').split(/\r?\n/).slice(0, MARKER_WINDOW).join('\n');
  const m = MARKER.exec(head);
  return m ? m[1] : null;
}

/**
 * Every relative markdown link inside the banner window, resolved the way a
 * renderer resolves it: against the FILE's directory, not the repo root.
 *
 * This check exists because it caught a real mistake on its first run. The
 * banner on docs/DAEMON-MESH-ARCHITECTURE.md linked `docs/adr/0122-...`, which
 * renders as `docs/docs/adr/0122-...` and 404s. check-doc-citations.mjs read
 * the same paths as repo-relative and passed them. A retirement banner whose
 * "read this instead" link is dead is worse than no banner: it tells a reader
 * the replacement exists and then loses it.
 */
function brokenBannerLinks(absPath, relPath) {
  const head = readFileSync(absPath, 'utf8').split(/\r?\n/).slice(0, MARKER_WINDOW).join('\n');
  const base = dirname(join(REPO, relPath));
  const broken = [];
  for (const [, target] of head.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:|#|\/)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean) continue;
    if (!existsSync(normalize(join(base, clean)))) broken.push(target);
  }
  return broken;
}

/** Does a marker appear ANYWHERE in the file (used to catch below-the-fold banners)? */
function markerAnywhere(absPath) {
  const m = MARKER.exec(readFileSync(absPath, 'utf8'));
  return m ? m[1] : null;
}

const liveAdrNumbers = new Set();
const adrDir = join(REPO, 'docs', 'adr');
if (existsSync(adrDir)) {
  for (const f of readdirSync(adrDir)) {
    const m = /^(\d{4})-.*\.md$/.exec(f);
    if (!m) continue;
    // A forwarding stub is not a destination worth pointing a retirement at.
    if (/<!--\s*ADR-RENUMBERED-TO:/.test(readFileSync(join(adrDir, f), 'utf8'))) continue;
    liveAdrNumbers.add(m[1]);
  }
}

// ── Direction 1: every manifest entry is real, marked, and points somewhere ──
const declared = new Set();
for (const [relPath, entry] of Object.entries(entries)) {
  const abs = join(REPO, relPath);
  declared.add(relPath.split('/').join(sep));

  if (!existsSync(abs)) {
    fail(`${relPath}: listed as retired but the file does not exist. Retirement is demotion, not deletion — restore it or drop the entry.`);
    continue;
  }
  const supersededBy = String(entry.supersededBy ?? '').replace(/^ADR-/, '');
  if (!/^\d{4}$/.test(supersededBy)) {
    fail(`${relPath}: manifest "supersededBy" must name an ADR (e.g. "ADR-0126"), got ${JSON.stringify(entry.supersededBy)}.`);
    continue;
  }
  if (!liveAdrNumbers.has(supersededBy)) {
    fail(`${relPath}: superseded by ADR-${supersededBy}, which is not a live ADR in docs/adr/. A retirement must point at something a reader can open.`);
  }
  if (!entry.reason || String(entry.reason).trim().length === 0) {
    fail(`${relPath}: manifest entry needs a non-empty "reason" — a retirement with no stated cause is an unexplained deletion with extra steps.`);
  }

  const marked = markerIn(abs);
  if (!marked) {
    const late = markerAnywhere(abs);
    fail(
      late
        ? `${relPath}: RETIRED-BY marker found, but below line ${MARKER_WINDOW}. A retirement notice under the fold is not a notice — move the banner to the top.`
        : `${relPath}: listed as retired but carries no "RETIRED-BY: ADR-NNNN" marker in its first ${MARKER_WINDOW} lines.`,
    );
  } else if (marked !== supersededBy) {
    fail(`${relPath}: banner says ADR-${marked}, manifest says ADR-${supersededBy}. One of them is wrong.`);
  }

  for (const target of brokenBannerLinks(abs, relPath)) {
    fail(`${relPath}: banner links to "${target}", which does not resolve from this file's directory. Markdown links resolve against the FILE, not the repo root.`);
  }
}

// ── Direction 2: nothing is marked retired without being declared ────────────
function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walk(abs));
    else if (SCANNED.some((e) => name.endsWith(e))) out.push(abs);
  }
  return out;
}

for (const abs of walk(REPO)) {
  const rel = relative(REPO, abs);
  if (abs === MANIFEST_PATH) continue;
  if (declared.has(rel)) continue;
  // The guard's own source and its fixtures describe the marker; they are not
  // retired documents. Matching on path is exact, not a heuristic on content.
  if (rel.split(sep)[0] === 'tests' || rel.split(sep)[0] === 'scripts') continue;
  const num = markerAnywhere(abs);
  if (num) {
    fail(`${rel.split(sep).join('/')}: carries a RETIRED-BY: ADR-${num} banner but is NOT in ${relative(REPO, MANIFEST_PATH).split(sep).join('/')}. Register it, so the manifest cannot fall behind the tree.`);
  }
}

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ ok: errors.length === 0, errors, retired: Object.keys(entries) }, null, 2) + '\n');
} else if (errors.length) {
  process.stdout.write('\n✗ DOC RETIREMENT GUARD\n\n');
  for (const e of errors) process.stdout.write(`    ${e}\n`);
  process.stdout.write('\n  The manifest is docs/retirement-manifest.json; the authority for what is\n  retired and why is the superseding ADR itself.\n\n');
} else {
  process.stdout.write(`doc-retirement-guard: ✓ ${Object.keys(entries).length} retired document(s), each bannered and pointing at a live ADR.\n`);
}

process.exit(errors.length ? 1 : 0);
