#!/usr/bin/env node
/**
 * validate-critical-binaries.mjs — fail a release build if a required
 * artifact is missing, zero/undersized, or (when declared) not executable.
 *
 * Why this exists: release.yml has repeatedly shipped without a critical
 * artifact because nothing checked for its presence after packaging —
 * pd-bosun was once missing entirely (the daemon shipped with no watchdog,
 * silently skipping the KeepAlive supervisor job), and the squid tentacles
 * (pd-hook-prompt/pre-tool/post-tool, pd-statusline) were never staged into
 * any release at all until this was caught by an operator hitting "missing
 * tentacle binary" on an up-to-date install. Both were one-line omissions
 * in a `tar -czf` file list that nothing verified. This script is the
 * reusable version of the ad-hoc `test -s dist/<file>` checks that grew up
 * around individual artifacts — one manifest per packaging job, one gate.
 *
 * Usage:
 *   node scripts/validate-critical-binaries.mjs <manifest.json> [--dir <override>]
 *
 * Manifest shape (see scripts/release-manifests/*.json for real examples):
 *   {
 *     "dir": "dist",                 // base directory, relative to cwd
 *     "binaries": [
 *       { "path": "pd", "minBytes": 1000, "executable": true },
 *       { "path": "bin/pd-hook-prompt", "minBytes": 10, "executable": true },
 *       { "path": "port-daddy-manifest.json", "minBytes": 2 },
 *       { "glob": "PortDaddy-FleetBar-macOS-*.zip", "minBytes": 1000000 }
 *     ]
 *   }
 *
 * An entry declares exactly one of "path" (exact, relative to dir) or "glob"
 * (single `*` wildcard, for artifacts whose name carries a runner-dependent
 * value like $(uname -m) — e.g. FleetBar's zip is
 * PortDaddy-FleetBar-macOS-${ARCH}.zip). A glob must match exactly one file:
 * zero is "missing", more than one is treated as a failure too, since an
 * ambiguous match means the manifest entry isn't precise enough to prove
 * anything about a specific artifact.
 *
 * --dir overrides the manifest's "dir" (useful when a workflow stages into
 * a differently-named directory per matrix leg, e.g. dist/${{ matrix.target }}).
 *
 * Exit 0: every declared artifact exists, meets its minBytes floor, and
 *         (if executable:true) has at least one execute bit set.
 * Exit 1: prints every failure found (not just the first) so a release
 *         author fixes the whole manifest in one pass, then the failure
 *         reason for each.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function fail(message) {
  console.error(`✗ ${message}`);
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function resolveGlobPath(baseDir, glob) {
  const pattern = globToRegExp(glob);
  let entries;
  try {
    entries = readdirSync(baseDir);
  } catch {
    return { error: `no files found (directory missing: ${baseDir})` };
  }
  const matches = entries.filter((name) => pattern.test(name));
  if (matches.length === 0) {
    return { error: `no file matching "${glob}" in ${baseDir}` };
  }
  if (matches.length > 1) {
    return { error: `ambiguous — ${matches.length} files matched "${glob}" in ${baseDir}: ${matches.join(', ')}` };
  }
  return { relPath: matches[0] };
}

function main() {
  const args = process.argv.slice(2);
  const manifestArgIndex = args.findIndex((a) => !a.startsWith('--'));
  const manifestPath = manifestArgIndex >= 0 ? args[manifestArgIndex] : null;
  const dirFlagIndex = args.indexOf('--dir');
  const dirOverride = dirFlagIndex >= 0 ? args[dirFlagIndex + 1] : null;

  if (!manifestPath) {
    console.error('Usage: node scripts/validate-critical-binaries.mjs <manifest.json> [--dir <override>]');
    process.exit(2);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read/parse manifest at ${manifestPath}: ${err.message}`);
    process.exit(2);
  }

  if (!Array.isArray(manifest.binaries) || manifest.binaries.length === 0) {
    console.error(`Manifest ${manifestPath} declares no "binaries" — nothing to check. This is almost certainly a mistake, not an empty release.`);
    process.exit(2);
  }

  const baseDir = resolve(dirOverride ?? manifest.dir ?? '.');
  const failures = [];

  for (const entry of manifest.binaries) {
    if (!entry.path && !entry.glob) {
      failures.push(`manifest entry missing "path" or "glob": ${JSON.stringify(entry)}`);
      continue;
    }
    if (entry.path && entry.glob) {
      failures.push(`manifest entry declares both "path" and "glob" — pick one: ${JSON.stringify(entry)}`);
      continue;
    }

    let relPath = entry.path;
    const label = entry.path ?? `glob:${entry.glob}`;
    if (entry.glob) {
      const resolved = resolveGlobPath(baseDir, entry.glob);
      if (resolved.error) {
        failures.push(`${label} — ${resolved.error}`);
        continue;
      }
      relPath = resolved.relPath;
    }

    const fullPath = join(baseDir, relPath);
    const minBytes = entry.minBytes ?? 1;

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      failures.push(`${label} — missing (expected at ${fullPath})`);
      continue;
    }

    if (!stat.isFile()) {
      failures.push(`${label} — exists but is not a regular file`);
      continue;
    }

    if (stat.size < minBytes) {
      failures.push(`${label} — ${stat.size} bytes, below the ${minBytes}-byte floor (looks truncated/empty, not a real artifact)`);
      continue;
    }

    if (entry.executable) {
      const hasExecuteBit = (stat.mode & 0o111) !== 0;
      if (!hasExecuteBit) {
        failures.push(`${label} — present and non-empty, but has no execute bit set (mode ${(stat.mode & 0o777).toString(8)})`);
        continue;
      }
    }
  }

  if (failures.length > 0) {
    console.error(`validate-critical-binaries: ${failures.length} of ${manifest.binaries.length} required artifact(s) failed, checked against ${baseDir}:\n`);
    for (const f of failures) fail(f);
    console.error(`\nA release must not ship with a missing/empty/non-executable critical artifact. Fix the packaging step that should have produced it, or fix this manifest (${manifestPath}) if the requirement itself is wrong.`);
    process.exit(1);
  }

  console.log(`✓ validate-critical-binaries: all ${manifest.binaries.length} required artifact(s) present in ${baseDir}`);
}

main();
