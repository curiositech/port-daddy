#!/usr/bin/env node
// imprint_release_artifacts.mjs -- content-hash a verified release cargo.
//
// Run this AFTER verify_release_artifacts.mjs passes, never instead of it --
// imprint proves the bits are what they claim to be (not tampered, not
// partially uploaded, not silently replaced by a mirror); it does not prove
// the bits are complete or correct in the first place. Verify is the
// fail-loud presence gate; imprint is the tamper-evidence layer on top of a
// cargo that already passed verify.
//
// The hash manifest this writes is the thing a downstream consumer (a brew
// formula's sha256 field, an installer's checksum check, an operator running
// `shasum -a 256 -c`) can compare against -- so "the binary I got matches the
// binary that was built" is a checkable claim, not a trust assertion.
//
// Usage:
//   node imprint_release_artifacts.mjs <manifest.json> --out <hashes.json> [--root <dir>]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

function parseArgs(argv) {
  const opts = { manifestPath: null, root: process.cwd(), out: null };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      opts.root = argv[i + 1];
      i += 1;
    } else if (arg === '--out') {
      opts.out = argv[i + 1];
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 1) throw new Error('Expected exactly one positional argument: <manifest.json>');
  if (!opts.out) throw new Error('--out <hashes.json> is required');
  opts.manifestPath = positional[0];
  return opts;
}

function printHelp() {
  process.stdout.write(
    'imprint_release_artifacts -- sha256 hash-manifest of a sealed release cargo\n\n' +
      'Usage: node imprint_release_artifacts.mjs <manifest.json> --out <hashes.json> [--root <dir>]\n',
  );
}

function resolvePath(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function imprintReleaseArtifacts(manifest, root) {
  const artifacts = [];
  const skipped = [];
  for (const artifact of manifest.artifacts) {
    const resolved = resolvePath(root, artifact.stagedPath);
    if (!existsSync(resolved)) {
      skipped.push({ id: artifact.id, reason: 'not present at imprint time' });
      continue;
    }
    const st = statSync(resolved);
    artifacts.push({
      id: artifact.id,
      path: artifact.stagedPath,
      bytes: st.size,
      sha256: sha256File(resolved),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    artifacts,
    skipped,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.manifestPath)) throw new Error(`Manifest not found: ${opts.manifestPath}`);
  const manifest = JSON.parse(readFileSync(opts.manifestPath, 'utf8'));
  const imprint = imprintReleaseArtifacts(manifest, opts.root);
  writeFileSync(opts.out, `${JSON.stringify(imprint, null, 2)}\n`);
  console.log(
    `Wrote imprint for ${imprint.artifacts.length} artifact(s) -> ${opts.out}` +
      (imprint.skipped.length > 0 ? ` (${imprint.skipped.length} skipped -- not present)` : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
