#!/usr/bin/env node
/**
 * adr-number-collision-guard.mjs — fail-closed ADR-number collision gate.
 *
 * Why this exists: `docs/adr/` accreted TWELVE number collisions (two or three
 * ADRs sharing one NNNN) because nothing at commit time asked "does this number
 * already belong to another ADR?". A collided number silently misroutes every
 * downstream link, `pd adr` lookup, and greenfield re-extraction. This gate
 * closes the hole the same way the README-freshness gate closed README drift.
 *
 * THE INVARIANT (fail-closed): every ADR number maps to exactly ONE live ADR
 * file. A "live" ADR is a `docs/adr/NNNN-*.md` file that is NOT a forwarding
 * stub. Forwarding stubs (left behind by a renumber so old links don't 404)
 * carry a structured marker line `<!-- ADR-RENUMBERED-TO: NNNN -->` and are
 * excluded from the collision count. The marker is a structured field we own,
 * not a content heuristic.
 *
 * It also keeps `docs/adr/adr-numbering-registry.json` honest: the registry is
 * a pure projection of the `docs/adr/` tree, so the gate can regenerate it and
 * fail when the on-disk copy is stale (same freshness discipline as README).
 *
 * Modes:
 *   node scripts/adr-number-collision-guard.mjs              # check whole corpus
 *   node scripts/adr-number-collision-guard.mjs --staged     # hook: only when a
 *                                                            #   staged path is under docs/adr/
 *   node scripts/adr-number-collision-guard.mjs --json       # machine-readable
 *   node scripts/adr-number-collision-guard.mjs --write-registry
 *
 * Bypass (one-time bulk-renumber PR only): PD_ADR_GUARD_OK=1, logged to stderr.
 *
 * Exit codes: 0 = clean (or bypassed / no staged ADR change), 1 = collision or
 * stale registry, 2 = cannot determine (not a git repo / adr dir missing).
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const ADR_DIR = join(REPO, 'docs', 'adr');
const REGISTRY_PATH = join(ADR_DIR, 'adr-numbering-registry.json');

const argv = new Set(process.argv.slice(2));
const JSON_OUT = argv.has('--json');
const STAGED = argv.has('--staged');
const WRITE = argv.has('--write-registry');

const RENUMBER_MARKER = /<!--\s*ADR-RENUMBERED-TO:\s*(\d{4})\s*-->/;
const NUMBERED = /^(\d{4})-(.+)\.md$/;

function die(code, msg) {
  if (msg) console.error(msg);
  process.exit(code);
}

if (!existsSync(ADR_DIR)) {
  die(2, `adr-guard: ${ADR_DIR} not found; skipping gate.`);
}

// --staged: cheap-exit unless a staged path touches docs/adr/.
if (STAGED && !WRITE) {
  let staged = '';
  try {
    staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf-8' });
  } catch (e) {
    die(2, `adr-guard: cannot read staged files (${e.message ?? e}); skipping gate.`);
  }
  const touchesAdr = staged.split('\n').some((p) => p.trim().startsWith('docs/adr/'));
  if (!touchesAdr) process.exit(0);
}

/** Build the registry object as a pure projection of docs/adr/. */
function buildRegistry() {
  const files = readdirSync(ADR_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');

  const liveByNumber = new Map(); // "0040" -> [file, …]
  const stubs = [];               // { file, number, renumberedTo }
  const offConvention = [];

  for (const file of files.sort()) {
    const m = file.match(NUMBERED);
    if (!m) {
      offConvention.push(file);
      continue;
    }
    const number = m[1];
    const content = readFileSync(join(ADR_DIR, file), 'utf-8');
    const stub = content.match(RENUMBER_MARKER);
    if (stub) {
      stubs.push({ file, number, renumberedTo: stub[1] });
      continue;
    }
    if (!liveByNumber.has(number)) liveByNumber.set(number, []);
    liveByNumber.get(number).push(file);
  }

  // numbers map + collisions
  const numbers = {};
  const collisions = [];
  for (const [number, list] of [...liveByNumber.entries()].sort()) {
    numbers[number] = list.length === 1 ? list[0] : list.slice().sort();
    if (list.length > 1) collisions.push({ number, files: list.slice().sort() });
  }

  // resolvedCollisions derived from stubs: group by original number.
  const byOrig = new Map();
  for (const s of stubs.sort((a, b) => a.file.localeCompare(b.file))) {
    if (!byOrig.has(s.number)) byOrig.set(s.number, []);
    const slug = s.file.match(NUMBERED)[2];
    byOrig.get(s.number).push({ oldFile: s.file, to: s.renumberedTo, newFile: `${s.renumberedTo}-${slug}.md` });
  }
  const resolvedCollisions = [...byOrig.entries()]
    .sort()
    .map(([number, renumbered]) => ({
      number,
      keep: numbers[number] && typeof numbers[number] === 'string' ? numbers[number] : null,
      renumbered,
    }));

  return {
    $schema: 'internal://port-daddy/adr-numbering-registry',
    description:
      'Authoritative number → file map for docs/adr/. A pure projection of the ADR ' +
      'directory, regenerated by scripts/adr-number-collision-guard.mjs --write-registry. ' +
      'Every number maps to exactly one LIVE ADR; forwarding stubs (ADR-RENUMBERED-TO marker) ' +
      'are recorded separately. Do not hand-edit — it is gate truth.',
    generatedBy: 'scripts/adr-number-collision-guard.mjs --write-registry',
    counts: {
      live: Object.keys(numbers).length,
      stubs: stubs.length,
      offConvention: offConvention.length,
    },
    numbers,
    stubs: stubs
      .slice()
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((s) => ({ file: s.file, renumberedTo: s.renumberedTo })),
    offConvention: offConvention.sort(),
    resolvedCollisions,
    _collisions: collisions, // present only when the invariant is violated
  };
}

const built = buildRegistry();
const collisions = built._collisions;
// Strip the transient _collisions field from the persisted/compared form.
const canonical = { ...built };
delete canonical._collisions;
const canonicalJson = JSON.stringify(canonical, null, 2) + '\n';

if (WRITE) {
  writeFileSync(REGISTRY_PATH, canonicalJson);
  console.log(`adr-guard: wrote ${REGISTRY_PATH} (${canonical.counts.live} live, ${canonical.counts.stubs} stubs)`);
  process.exit(0);
}

// Registry freshness (only meaningful once the registry exists).
let registryStale = false;
if (existsSync(REGISTRY_PATH)) {
  const onDisk = readFileSync(REGISTRY_PATH, 'utf-8');
  registryStale = onDisk !== canonicalJson;
}

const report = {
  clean: collisions.length === 0 && !registryStale,
  collisions,
  registryStale,
  registryExists: existsSync(REGISTRY_PATH),
};

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));

if (process.env.PD_ADR_GUARD_OK === '1') {
  console.error(
    'adr-guard: bypassed via PD_ADR_GUARD_OK=1 (one-time bulk-renumber PR). ' +
      `collisions=${collisions.length} registryStale=${registryStale}`,
  );
  process.exit(0);
}

if (report.clean) {
  if (!JSON_OUT) console.log('adr-guard: ✓ every ADR number maps to exactly one live file; registry fresh.');
  process.exit(0);
}

if (collisions.length > 0) {
  console.error('\n✗ ADR NUMBER COLLISION — a number maps to more than one live ADR:\n');
  for (const c of collisions) {
    console.error(`    ${c.number}:`);
    for (const f of c.files) console.error(`        docs/adr/${f}`);
  }
  console.error(`
  Resolve it: keep the number on the most-cited / earliest-accepted ADR, rename
  the other to the next free number, leave a forwarding stub at the old path
  (H1 + "<!-- ADR-RENUMBERED-TO: NNNN -->"), and regenerate the registry:

      node scripts/adr-number-collision-guard.mjs --write-registry
      git add docs/adr

  One-time bulk pass only: PD_ADR_GUARD_OK=1 (logged).
`);
}

if (registryStale) {
  console.error(
    `\n✗ ADR REGISTRY STALE — docs/adr/adr-numbering-registry.json does not match the tree.\n` +
      `  Regenerate and stage it:\n      node scripts/adr-number-collision-guard.mjs --write-registry\n      git add docs/adr/adr-numbering-registry.json\n`,
  );
}

process.exit(1);
