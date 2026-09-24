#!/usr/bin/env node
// Explicit maintenance command: review source attribution changes before
// regenerating. This receipt confers no runtime or installation authority.
import { readFileSync, writeFileSync } from 'node:fs';
import { CATALOG_PATH, MANIFEST_PATH, containsAttribution, digest,
  eligibleAttributionPath, collectAttributionFiles, validateAttributionManifest } from './lib/skill-source-attribution.mjs';

const names = new Set(readFileSync(CATALOG_PATH, 'utf8').trim().split('\n').slice(1).map((line) => line.split(',')[0]));
const check = process.argv.includes('--check');
const manifest = check ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : { entries: [] };
const files = collectAttributionFiles(process.cwd(), manifest);
if (process.argv.includes('--check')) {
  const errors = validateAttributionManifest(manifest, files, names);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Source-attribution hashes and repository boundaries pass.');
} else {
  const entries = [];
  for (const [path, bytes] of files) {
    if (path === MANIFEST_PATH || !containsAttribution(path, bytes)) continue;
    if (!eligibleAttributionPath(path, names)) throw new Error(`Cannot approve native authority path: ${path}`);
    entries.push({ path, sha256: digest(bytes) });
  }
  writeFileSync(MANIFEST_PATH, `${JSON.stringify({ schemaVersion: 1, entries }, null, 2)}\n`);
  console.log(`Recorded ${entries.length} exact source-attribution files for review.`);
}
