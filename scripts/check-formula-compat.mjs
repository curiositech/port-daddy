#!/usr/bin/env node
/**
 * Formula-compat preflight — "will Homebrew actually accept the tarball we are
 * about to seal?"
 *
 * The tap formula (curiositech/homebrew-tap, Formula/port-daddy.rb) carries a
 * self-verifying tarball gate: it pins the sha256 of the sorted, comma-joined
 * list of top-level tarball entries it has been reviewed against, and `odie`s
 * the install when the extracted tarball doesn't match. That gate saved users
 * from silently-dropped files — but nothing on the REPO side checked the same
 * invariant, so release.yml's tar list drifted (bin/ + hooks/ were added for
 * the squid harness) and for weeks every release cut from main would have
 * produced a tarball the formula rejects at `brew install`. Meanwhile the tap
 * moved to the 3.28 single-supervisor layout with no repo-side counterpart.
 *
 * This script closes the loop from the producing side: given the release
 * version and the exact top-level entry list release.yml is about to tar, it
 * fetches the live formula, extracts the expected manifest hash for that
 * version, and fails LOUDLY before anything is sealed or published.
 *
 * Usage:
 *   node scripts/check-formula-compat.mjs --version 3.28.0 \
 *     --entries "pd port-daddy port-daddy-manifest.json native bin hooks skills agents"
 *
 * Options:
 *   --version <semver>        release version (leading "v" ok)   [required]
 *   --entries "<a b c ...>"   space- or comma-separated top-level tarball
 *                             entries (exactly the tar command's args) [required]
 *   --formula-file <path>     read the formula from a file instead of the
 *                             network (tests / offline)
 *   --formula-url <url>       override the raw formula URL
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const DEFAULT_FORMULA_URL =
  'https://raw.githubusercontent.com/curiositech/homebrew-tap/main/Formula/port-daddy.rb';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') out.version = argv[++i];
    else if (a === '--entries') out.entries = argv[++i];
    else if (a === '--formula-file') out.formulaFile = argv[++i];
    else if (a === '--formula-url') out.formulaUrl = argv[++i];
    else {
      console.error(`check-formula-compat: unknown argument ${a}`);
      process.exit(2);
    }
  }
  return out;
}

/** sha256 of the sorted, comma-joined entry list — the formula's exact recipe. */
export function entryListHash(entries) {
  return createHash('sha256').update([...entries].sort().join(',')).digest('hex');
}

/**
 * Pull the tarball-gate facts out of the formula source. Deliberately tolerant
 * of comments/whitespace but LOUD when the shape it relies on is gone — a
 * formula refactor that renames these variables must fail this check, not
 * silently pass it.
 */
export function parseFormulaGate(rubySource) {
  const hashes = {};
  const hashRe = /(\w+)_manifest_sha256\s*=\s*\n?\s*"([0-9a-f]{64})"/g;
  for (const m of rubySource.matchAll(hashRe)) hashes[m[1]] = m[2];
  const names = Object.keys(hashes);
  if (names.length === 0) {
    throw new Error(
      'no *_manifest_sha256 assignments found in the formula — the tarball gate moved or was removed; update scripts/check-formula-compat.mjs to match',
    );
  }

  // The formula selects the hash by version: `if version >= Version.new("X.Y.Z")`.
  const cutoffMatch = rubySource.match(/version\s*>=\s*Version\.new\("(\d+\.\d+\.\d+)"\)/);

  if (names.length === 1) return { hashes, cutoff: null, single: names[0], legacy: names[0] };

  if (!cutoffMatch) {
    throw new Error(
      `formula declares ${names.length} manifest hashes (${names.join(', ')}) but no "version >= Version.new(...)" selector was found — update scripts/check-formula-compat.mjs to match the formula's new selection logic`,
    );
  }

  // Convention in the formula: the >= branch uses the newer layout's hash.
  const branchRe = /if\s+version\s*>=\s*Version\.new\("[\d.]+"\)\s*\n\s*(\w+)_manifest_sha256\s*\n\s*else\s*\n\s*(\w+)_manifest_sha256/;
  const branches = rubySource.match(branchRe);
  if (!branches) {
    throw new Error(
      'could not resolve which manifest hash the formula uses above/below the version cutoff — update scripts/check-formula-compat.mjs to match',
    );
  }
  return {
    hashes,
    cutoff: cutoffMatch[1],
    single: branches[1],
    legacy: branches[2],
  };
}

function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export function expectedHashFor(gate, version) {
  if (gate.cutoff === null) return { name: gate.single, hash: gate.hashes[gate.single] };
  const name = compareSemver(version, gate.cutoff) >= 0 ? gate.single : gate.legacy;
  return { name, hash: gate.hashes[name] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version || !args.entries) {
    console.error('check-formula-compat: --version and --entries are required');
    process.exit(2);
  }
  const version = args.version.replace(/^v(?=\d)/i, '').replace(/-.*$/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`check-formula-compat: "${args.version}" does not contain a valid x.y.z version`);
    process.exit(2);
  }
  const entries = args.entries.split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) {
    console.error('check-formula-compat: --entries resolved to an empty list');
    process.exit(2);
  }

  let formula;
  if (args.formulaFile) {
    formula = readFileSync(args.formulaFile, 'utf8');
  } else {
    const url = args.formulaUrl || DEFAULT_FORMULA_URL;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`check-formula-compat: fetching the formula failed (${res.status} ${res.statusText}) from ${url}`);
      process.exit(1);
    }
    formula = await res.text();
  }

  let gate;
  try {
    gate = parseFormulaGate(formula);
  } catch (err) {
    console.error(`check-formula-compat: ${err.message}`);
    process.exit(1);
  }

  const actual = entryListHash(entries);
  const expected = expectedHashFor(gate, version);

  console.log(`check-formula-compat: version ${version} → formula branch "${expected.name}"`);
  console.log(`  tarball entries (sorted): ${[...entries].sort().join(', ')}`);
  console.log(`  computed hash: ${actual}`);
  console.log(`  formula hash:  ${expected.hash}`);

  if (actual !== expected.hash) {
    console.error(
      `\ncheck-formula-compat: MISMATCH — a v${version} tarball with these top-level entries will be REJECTED by \`brew install\` (the formula's self-verifying gate odies on it).\n` +
        `Either release.yml's tar list changed without a matching formula update, or the tap moved to a new layout without a repo-side change.\n` +
        `Fix whichever side is wrong, in the same change set: release.yml's TARBALL_ENTRIES + release-artifacts.json here, install() + the pinned hash in curiositech/homebrew-tap.`,
    );
    process.exit(1);
  }
  console.log('check-formula-compat: OK — the formula accepts this layout.');
}

// Allow importing the pure helpers from tests without running main.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`check-formula-compat: ${err.stack || err}`);
    process.exit(1);
  });
}
