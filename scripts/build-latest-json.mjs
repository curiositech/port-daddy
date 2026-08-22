#!/usr/bin/env node
/**
 * scripts/build-latest-json.mjs — generate the `latest.json` update feed for a
 * release (ADR-0057 phase 7, "dist-update-channel").
 *
 * Scans a directory of built release artifacts, computes the SHA-256 of each,
 * and emits a `latest.json` manifest (version + per-surface download URL +
 * checksum) for `pd upgrade` and the GUI apps to consume. The canonical schema +
 * types live in lib/latest-manifest.ts and are exercised by the consumer + unit
 * tests; this .mjs script does NOT import them — to stay dependency-free / TS-
 * build-free for the release runner, it DUPLICATES the small amount of structural
 * validation it needs (semver parse + checksum-shape guard) from that module.
 * Keep the two in sync (or add a round-trip test) when the schema changes.
 *
 * Usage:
 *   node scripts/build-latest-json.mjs \
 *     --tag v3.20.0 \
 *     --dist dist \
 *     --out dist/latest.json \
 *     [--repo curiositech/port-daddy] \
 *     [--signed]            # mark mac artifacts as Developer-ID signed+notarized
 *
 * The download URLs are GitHub Release asset URLs:
 *   https://github.com/<repo>/releases/download/<tag>/<filename>
 *
 * Run AFTER the artifacts are built/signed so the checksums match what ships.
 * In release.yml this runs in a small job that downloads the uploaded assets,
 * generates the feed, and uploads latest.json back to the same Release (so
 * `releases/latest/download/latest.json` resolves to the newest feed).
 *
 * Artifact → surface mapping (ADR-0057's three distributable surfaces; the MCP
 * + agent skill ride inside the daemon binary, so they are NOT separate feed
 * entries):
 *   pd-darwin-arm64.tar.gz          → daemon (darwin-arm64)
 *   pd-linux-x64.tar.gz             → daemon (linux-x64)
 *   PortDaddy-Console-macOS-*.zip   → console
 *   PortDaddy-FleetBar-macOS-*.zip  → fleetbar
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// NOTE: this script intentionally does NOT import lib/latest-manifest.ts. The
// canonical types + validation live there (and are exercised by the consumer +
// unit tests), but importing a .ts module would require a TS build step in this
// release-runner script. So the small amount of structural validation the
// PRODUCER needs (semver parse + checksum-shape guard) is DUPLICATED here, kept
// deliberately minimal. Keeping this dependency-free is the point: the release
// runner must run it with plain `node`. If the schema changes, update both
// places (or add a round-trip test asserting this output parses via
// parseLatestManifest).

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--signed') { out.signed = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

/**
 * Map a release-asset filename to its (surface, platform, signed-by-default)
 * descriptor. Returns null for files that are not feed surfaces (the .sha256
 * sidecars, the manifest json, etc.). The mapping is over STRUCTURED filename
 * shapes we control — no NLP guessing.
 */
function classifyArtifact(filename) {
  if (filename === 'pd-darwin-arm64.tar.gz') return { surface: 'daemon', platform: 'darwin-arm64', macSigned: true };
  if (filename === 'pd-linux-x64.tar.gz') return { surface: 'daemon', platform: 'linux-x64', macSigned: false };
  const consoleMatch = /^PortDaddy-Console-macOS-(.+)\.zip$/.exec(filename);
  if (consoleMatch) return { surface: 'console', platform: `darwin-${consoleMatch[1]}`, macSigned: true };
  const fleetMatch = /^PortDaddy-FleetBar-macOS-(.+)\.zip$/.exec(filename);
  if (fleetMatch) return { surface: 'fleetbar', platform: `darwin-${fleetMatch[1]}`, macSigned: true };
  return null;
}

function fleetbarSignedFromManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.warn(`build-latest-json: ignoring unusable FleetBar manifest at ${manifestPath}: malformed JSON`);
    return null;
  }

  if (typeof manifest.unsigned !== 'boolean') {
    const actual = Object.prototype.hasOwnProperty.call(manifest, 'unsigned') ? typeof manifest.unsigned : 'missing';
    console.warn(`build-latest-json: ignoring unusable FleetBar manifest at ${manifestPath}: unsigned must be boolean (got ${actual})`);
    return null;
  }

  // Gatekeeper accepts a DOWNLOADED .app only when it is Developer ID signed
  // AND notarized. v3.27.0 shipped signed-but-unnotarized (notary key failed
  // validation, fail-soft) while the feed said signed:true — the fresh-install
  // smoke caught Gatekeeper rejecting exactly what the feed advertised as good.
  // A manifest that carries `notarized` participates in the flag; an older
  // manifest without it keeps the signing-only semantics it was written with.
  if (typeof manifest.notarized === 'boolean') {
    return !manifest.unsigned && manifest.notarized;
  }

  return !manifest.unsigned;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = args.tag;
  const distDir = args.dist || 'dist';
  const repo = args.repo || 'curiositech/port-daddy';
  const outPath = args.out || join(distDir, 'latest.json');
  const signedFlag = !!args.signed;

  if (!tag) {
    console.error('build-latest-json: --tag <vX.Y.Z> is required');
    process.exit(2);
  }
  const version = String(tag).replace(/^v(?=\d)/i, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    console.error(`build-latest-json: tag "${tag}" does not contain a valid semver`);
    process.exit(2);
  }
  if (!existsSync(distDir)) {
    console.error(`build-latest-json: dist dir "${distDir}" does not exist`);
    process.exit(2);
  }

  // Discover artifact files anywhere under distDir (release.yml puts daemon tars
  // at dist/, FleetBar zips at dist/fleetbar/, console zips at dist/console/).
  const found = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else found.push(p);
    }
  };
  walk(distDir);

  // FleetBar uploads a manifest asset under dist/fleetbar/ that records whether
  // its .app was ACTUALLY signed (`unsigned: false` once it is). Derive the feed's
  // FleetBar `signed` flag from that truth rather than the blanket --signed flag,
  // which only means "the daemon was signed this release" — FleetBar's build
  // historically shipped ad-hoc while --signed marked it signed:true, so the feed
  // advertised a Gatekeeper-quarantined app as signed. `null` means no usable
  // manifest truth was found, so fall back to the blanket flag.
  const fleetbarSigned = fleetbarSignedFromManifest(join(distDir, 'fleetbar', 'fleetbar-preview-manifest.json'));

  const artifacts = [];
  for (const filePath of found) {
    const fn = basename(filePath);
    const cls = classifyArtifact(fn);
    if (!cls) continue;
    const sha256 = sha256File(filePath);
    let signed = signedFlag && cls.macSigned;
    if (cls.surface === 'fleetbar' && fleetbarSigned !== null) signed = fleetbarSigned;
    artifacts.push({
      surface: cls.surface,
      filename: fn,
      url: `https://github.com/${repo}/releases/download/${tag}/${fn}`,
      sha256,
      sizeBytes: statSync(filePath).size,
      platform: cls.platform,
      signed,
    });
  }

  if (artifacts.length === 0) {
    console.error(`build-latest-json: no recognized artifacts found under ${distDir}. ` +
      'Expected pd-darwin-arm64.tar.gz / pd-linux-x64.tar.gz / PortDaddy-Console-macOS-*.zip / PortDaddy-FleetBar-macOS-*.zip');
    process.exit(1);
  }

  // Validate checksums are well-formed hex (mirror buildLatestManifest's guard
  // so a malformed feed is caught at GENERATION time, in CI).
  for (const a of artifacts) {
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) {
      console.error(`build-latest-json: artifact ${a.surface} has invalid sha256 "${a.sha256}"`);
      process.exit(1);
    }
  }

  const manifest = {
    schema: 1,
    version,
    tag,
    publishedAt: new Date().toISOString(),
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    brewFormula: 'port-daddy',
    artifacts: artifacts.sort((a, b) => a.surface.localeCompare(b.surface) || a.platform.localeCompare(b.platform)),
  };

  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${outPath} (version ${version}, ${artifacts.length} artifact(s)):`);
  for (const a of artifacts) {
    console.log(`  ${a.surface.padEnd(9)} ${a.platform.padEnd(14)} ${a.sha256.slice(0, 12)}…  ${a.filename}`);
  }
}

main();
