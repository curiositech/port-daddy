#!/usr/bin/env node
// verify_release_artifacts.mjs -- fail-loud presence/exec/size check for a
// declarative release-artifacts manifest.
//
// This is the generalized form of a scattered ad-hoc check like:
//
//   test -s dist/pd-bosun
//
// hand-added to a release workflow the first time a missing binary broke an
// install. One manifest (release-artifacts.schema.json) plus one checker
// replaces N such lines that only ever cover the ONE artifact someone
// remembered to add a line for after it broke once.
//
// Usage:
//   node verify_release_artifacts.mjs <manifest.json> [--root <dir>] [--json]
//
//   <manifest.json>   path to a file matching ../schemas/release-artifacts.schema.json
//   --root <dir>      base directory artifact stagedPath entries are resolved
//                      against (default: process.cwd())
//   --json            emit a machine-readable report instead of text lines
//
// Exit code is 0 iff every required artifact PASSed. This is meant to be the
// literal last step before a release cargo is tarred/uploaded -- run it,
// check the exit code, stop the release if it is non-zero. Do not treat a
// non-zero exit as advisory.
//
// See also: imprint_release_artifacts.mjs (content-hash the verified cargo).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function parseArgs(argv) {
  const opts = { manifestPath: null, root: process.cwd(), json: false };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      const next = argv[i + 1];
      if (!next) throw new Error('--root requires a path');
      opts.root = next;
      i += 1;
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) {
    throw new Error('Expected exactly one positional argument: <manifest.json>');
  }
  opts.manifestPath = positional[0];
  return opts;
}

function printHelp() {
  process.stdout.write(
    'verify_release_artifacts -- fail-loud presence/exec/size check for a release-artifacts manifest\n\n' +
      'Usage: node verify_release_artifacts.mjs <manifest.json> [--root <dir>] [--json]\n',
  );
}

function loadManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) {
    throw new Error(`Manifest has no artifacts array (or it is empty): ${manifestPath}`);
  }
  return parsed;
}

function resolvePath(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

function verifyOne(root, artifact) {
  const required = artifact.required !== false; // default true
  const resolved = resolvePath(root, artifact.stagedPath);

  if (!existsSync(resolved)) {
    return {
      id: artifact.id,
      severity: required ? 'FAIL' : 'SKIP',
      reason: required
        ? `missing required artifact at ${artifact.stagedPath}${artifact.description ? ` -- ${artifact.description}` : ''}`
        : 'optional artifact absent (declared required: false)',
    };
  }

  const st = statSync(resolved);
  const minBytes = artifact.minBytes ?? 1;
  const failures = [];

  if (st.size < minBytes) {
    failures.push(`size ${st.size}B < minBytes ${minBytes} (looks truncated or a stub)`);
  }
  if (artifact.executable) {
    const hasExecBit = (st.mode & 0o111) !== 0;
    if (!hasExecBit) failures.push('not executable -- chmod +x was dropped by a copy/archive step');
  }

  if (failures.length > 0) {
    return { id: artifact.id, severity: 'FAIL', reason: failures.join('; ') };
  }
  return {
    id: artifact.id,
    severity: 'PASS',
    reason: `present, ${st.size}B${artifact.executable ? ', executable' : ''}`,
  };
}

export function verifyReleaseArtifacts(manifest, root) {
  return manifest.artifacts.map((artifact) => verifyOne(root, artifact));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(opts.manifestPath);
  const results = verifyReleaseArtifacts(manifest, opts.root);
  const fails = results.filter((r) => r.severity === 'FAIL');
  const pass = fails.length === 0;

  if (opts.json) {
    console.log(JSON.stringify({ pass, root: opts.root, results }, null, 2));
  } else {
    for (const r of results) {
      console.log(`[${r.severity}] ${r.id}: ${r.reason}`);
    }
    console.log('');
    console.log(
      pass
        ? `OK -- ${results.length} artifact(s) checked, all required artifacts present.`
        : `FAILED -- ${fails.length} of ${results.length} artifact(s) missing or invalid. Do not ship this cargo.`,
    );
  }

  process.exit(pass ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
