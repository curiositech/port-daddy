#!/usr/bin/env node
/**
 * check-version-drift.mjs — the single version drift gate (ADR-0057 phase
 * dist-version-authority, "One version, enforced").
 *
 * `package.json` is the sole version authority. `scripts/sync-version.ts` stamps
 * that version across every distribution surface. This script is the GATE that
 * FAILS CI when any surface has drifted from the authority — so a release can
 * never ship a daemon that says 3.20.0 next to a console that says 0.3.0.
 *
 * Two modes:
 *
 *   SOURCE mode (default, runs everywhere incl. jest/CI with no build):
 *     reads the version literal each surface declares in the repo and compares
 *     it to package.json. Catches "ran a bump but forgot a surface" and "edited
 *     one file by hand."
 *
 *   --deep mode (run when built artifacts exist, e.g. in release.yml after the
 *     bundles are produced): ALSO reads the *embedded* version reported by built
 *     artifacts — pd-console's binary build stamp and the .app plist's
 *     CFBundleShortVersionString — because ADR-0057 §Consequences warns the gate
 *     can be Goodharted by bumping the source string without rebuilding. A built
 *     artifact whose embedded version disagrees is the real failure we care about.
 *     Deep checks self-skip (not fail) when their artifact is absent, so deep mode
 *     is safe to run before everything is built; pass --require-artifacts to make
 *     a missing expected artifact a hard failure.
 *
 * Exit code 0 = all surfaces agree. Non-zero = drift (prints every offender).
 *
 * Usage:
 *   node scripts/check-version-drift.mjs            # source surfaces only
 *   node scripts/check-version-drift.mjs --deep     # + embedded artifact versions
 *   node scripts/check-version-drift.mjs --json     # machine-readable report
 *
 * The list of source surfaces is kept deliberately in lockstep with
 * scripts/sync-version.ts — if you teach sync-version.ts a new surface, add it
 * here too (and the drift-gate test will hold you to it for the ones it covers).
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const args = new Set(argv);
const DEEP = args.has('--deep');
const JSON_OUT = args.has('--json');
const REQUIRE_ARTIFACTS = args.has('--require-artifacts');

// --root <dir> overrides the repo root the gate scans. Defaults to the repo this
// script lives in. Used by the gate's own regression test to run against a
// sandbox copy of the version surfaces (clean vs. injected-drift) without
// mutating the working tree.
const rootFlagIdx = argv.indexOf('--root');
const ROOT =
  rootFlagIdx !== -1 && argv[rootFlagIdx + 1]
    ? argv[rootFlagIdx + 1]
    : join(dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

/** Pull a version out of a file with a regex; null if file or match missing. */
function literalFrom(rel, re) {
  const content = read(rel);
  if (content == null) return { value: null, missingFile: true };
  const m = content.match(re);
  return { value: m ? m[1] : null, missingFile: false };
}

function jsonField(rel, ...path) {
  const content = read(rel);
  if (content == null) return { value: null, missingFile: true };
  let obj;
  try {
    obj = JSON.parse(content);
  } catch (e) {
    return { value: null, missingFile: false, parseError: String(e) };
  }
  let cur = obj;
  for (const k of path) cur = cur?.[k];
  return { value: cur ?? null, missingFile: false };
}

const pkg = JSON.parse(read('package.json'));
const AUTHORITY = pkg.version;
if (!/^\d+\.\d+\.\d+/.test(AUTHORITY)) {
  console.error(`FATAL: package.json version "${AUTHORITY}" is not semver — there is no authority to gate against.`);
  process.exit(2);
}

/**
 * SOURCE surfaces — every place the product version is declared in the repo.
 * `get` returns { value, missingFile? }.
 */
const SOURCE_SURFACES = [
  { name: 'mcp-server.json', get: () => jsonField('mcp-server.json', 'version') },
  { name: '.claude-plugin/plugin.json', get: () => jsonField('.claude-plugin/plugin.json', 'version') },
  {
    name: '.gemini/extensions/port-daddy/gemini-extension.json',
    get: () => jsonField('.gemini/extensions/port-daddy/gemini-extension.json', 'version'),
  },
  { name: 'public/samples/manifest.json', get: () => jsonField('public/samples/manifest.json', 'packageVersion') },
  {
    name: 'mcp/server.ts',
    get: () => literalFrom('mcp/server.ts', /version:\s*['"](\d+\.\d+\.\d+[\w.\-+]*)['"]/),
  },
  {
    name: 'server.ts (EMBEDDED_PACKAGE_VERSION)',
    get: () => literalFrom('server.ts', /EMBEDDED_PACKAGE_VERSION:\s*string\s*=\s*['"](\d+\.\d+\.\d+[\w.\-+]*)['"]/),
  },
  {
    name: 'website-v2/src/data/referenceCatalog.ts (PORT_DADDY_VERSION)',
    get: () => literalFrom('website-v2/src/data/referenceCatalog.ts', /PORT_DADDY_VERSION\s*=\s*['"](\d+\.\d+\.\d+[\w.\-+]*)['"]/),
  },
  {
    name: 'VERSION',
    get: () => {
      const c = read('VERSION');
      if (c == null) return { value: null, missingFile: true };
      return { value: c.trim() || null, missingFile: false };
    },
  },
  {
    name: 'core/pd-console/Cargo.toml (CARGO_PKG_VERSION → pd-console --version)',
    get: () => literalFrom('core/pd-console/Cargo.toml', /^version\s*=\s*"(\d+\.\d+\.\d+[\w.\-+]*)"/m),
  },
  {
    // The repo's front door. Rotted from 3.13 to 3.24 before being gated.
    name: 'README.md (title version)',
    get: () => literalFrom('README.md', /^# ⚓ Port Daddy \(v(\d+\.\d+\.\d+[\w.\-+]*)\)/m),
  },
  {
    // The daemon's API version IS the product version; lied at 3.10.0 for months.
    name: 'docs/openapi.yaml (info.version)',
    get: () => literalFrom('docs/openapi.yaml', /^  version:\s*(\d+\.\d+\.\d+[\w.\-+]*)\s*$/m),
  },
];

/**
 * DEEP surfaces — embedded versions read out of BUILT artifacts. Each entry:
 *   probe() → { value, absent?, error? }
 * `absent: true` means "the artifact isn't built here" → skip (unless
 * --require-artifacts). `error` means the artifact exists but reading it failed
 * → that is a hard drift failure.
 */
const DEEP_SURFACES = [
  {
    name: 'pd-console.app/Contents/Info.plist (CFBundleShortVersionString)',
    probe() {
      // Search the conventional release output dirs for the bundled app.
      const candidates = [
        'dist/console/pd-console.app/Contents/Info.plist',
        'dist/pd-console.app/Contents/Info.plist',
        'core/pd-console/bundle/pd-console.app/Contents/Info.plist',
      ];
      const found = candidates.map((c) => join(ROOT, c)).find(existsSync);
      if (!found) return { absent: true };
      const plist = readFileSync(found, 'utf-8');
      const m = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
      if (!m) return { error: `CFBundleShortVersionString not found in ${found}` };
      return { value: m[1].trim(), from: found };
    },
  },
  {
    name: 'pd-console binary build stamp (CARGO_PKG_VERSION)',
    probe() {
      const candidates = [
        'core/pd-console/target/release/pd-console',
        'dist/console/pd-console.app/Contents/MacOS/pd-console',
      ];
      const bin = candidates.map((c) => join(ROOT, c)).find((p) => existsSync(p) && statSync(p).isFile());
      if (!bin) return { absent: true };
      // The headless engine bin prints its version on `--version` when wired;
      // fall back to reading the embedded CARGO_PKG_VERSION string from the
      // Mach-O so we never depend on the GPU binary being runnable in CI.
      try {
        const out = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 8000 });
        const m = out.match(/(\d+\.\d+\.\d+[\w.\-+]*)/);
        if (m) return { value: m[1], from: bin };
      } catch {
        /* not runnable here (wrong arch / no --version) — fall through to strings */
      }
      try {
        const raw = readFileSync(bin);
        // Cargo embeds the crate version; the build stamp format is
        // `pd-console v<ver> · built ...`. Find that exact, unambiguous marker.
        const text = raw.toString('latin1');
        const m = text.match(/pd-console v(\d+\.\d+\.\d+[\w.\-+]*)/);
        if (m) return { value: m[1], from: bin };
        return { error: `could not extract an embedded version from ${bin}` };
      } catch (e) {
        return { error: `failed to read ${bin}: ${e}` };
      }
    },
  },
];

const report = { authority: AUTHORITY, mode: DEEP ? 'deep' : 'source', surfaces: [], drift: [], skipped: [] };

for (const s of SOURCE_SURFACES) {
  const { value, missingFile, parseError } = s.get();
  if (missingFile) {
    report.skipped.push({ surface: s.name, reason: 'file absent' });
    continue;
  }
  if (parseError) {
    report.drift.push({ surface: s.name, expected: AUTHORITY, found: null, reason: parseError });
    continue;
  }
  if (value == null) {
    report.drift.push({ surface: s.name, expected: AUTHORITY, found: null, reason: 'no version literal matched' });
    continue;
  }
  report.surfaces.push({ surface: s.name, found: value });
  if (value !== AUTHORITY) {
    report.drift.push({ surface: s.name, expected: AUTHORITY, found: value });
  }
}

if (DEEP) {
  for (const s of DEEP_SURFACES) {
    const r = s.probe();
    if (r.absent) {
      if (REQUIRE_ARTIFACTS) {
        report.drift.push({ surface: s.name, expected: AUTHORITY, found: null, reason: 'artifact required but absent' });
      } else {
        report.skipped.push({ surface: s.name, reason: 'artifact not built here' });
      }
      continue;
    }
    if (r.error) {
      report.drift.push({ surface: s.name, expected: AUTHORITY, found: null, reason: r.error });
      continue;
    }
    report.surfaces.push({ surface: s.name, found: r.value, from: r.from });
    // The .app plist carries the full SemVer; the build stamp may carry a
    // prerelease/build suffix. Compare on the dotted-numeric core so a
    // 3.20.0 vs 3.20.0+ci stamp is not a false drift, but 0.3.0 vs 3.20.0 is.
    const norm = (v) => String(v).split(/[-+]/)[0];
    if (norm(r.value) !== norm(AUTHORITY)) {
      report.drift.push({ surface: s.name, expected: AUTHORITY, found: r.value });
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Version authority (package.json): ${AUTHORITY}   [${report.mode} mode]`);
  for (const s of report.surfaces) {
    const ok = s.found === AUTHORITY || String(s.found).split(/[-+]/)[0] === AUTHORITY.split(/[-+]/)[0];
    console.log(`  ${ok ? '✓' : '✗'} ${s.surface} → ${s.found}`);
  }
  for (const s of report.skipped) {
    console.log(`  · skipped: ${s.surface} (${s.reason})`);
  }
}

if (report.drift.length > 0) {
  console.error(`\n✗ VERSION DRIFT — ${report.drift.length} surface(s) disagree with package.json (${AUTHORITY}):`);
  for (const d of report.drift) {
    console.error(`    ${d.surface}: found ${d.found ?? 'NONE'}${d.reason ? ` (${d.reason})` : ''}`);
  }
  console.error(`\n  Fix: run \`bun scripts/sync-version.ts\` (it stamps package.json's version`);
  console.error(`  across every surface), rebuild any affected artifact, and re-run this gate.`);
  process.exit(1);
}

console.log(`\n✓ all ${report.surfaces.length} checked surface(s) agree on ${AUTHORITY}.`);
