#!/usr/bin/env node
/**
 * check-release-docs.mjs — the brew-cut docs gate, CI edition.
 *
 * `pd cut` already fail-closes a local brew cut whose operator-facing docs are
 * stale (shared/release.ts → releaseDocsPreflight). But the PUBLIC release path
 * (.github/workflows/release.yml → update-homebrew) builds binaries straight
 * from the tagged commit without going through `pd cut`, so it needs its own
 * gate or a tag could roll the Homebrew tap while CHANGELOG.md still has the
 * notes under [Unreleased] or README.md's title misreports the version.
 *
 * This script is that gate, kept dependency-free so it runs in a bare checkout.
 * It mirrors releaseDocsPreflight's two checks exactly (keep them in lockstep):
 *   - CHANGELOG.md has a dated `## [<version>] - YYYY-MM-DD` section, and
 *   - README.md's title advertises `Port Daddy (v<version>)`.
 *
 * A brew cut is the stable line: PRERELEASE tags (a `-` in the version, e.g.
 * `3.15.0-rc.1`) are opt-in candidates that don't roll the tap, so they SKIP
 * this gate — matching the `pd cut` tier/version gating.
 *
 * Usage:
 *   node scripts/check-release-docs.mjs --version 3.15.0
 *   node scripts/check-release-docs.mjs --tag v3.15.0
 *   node scripts/check-release-docs.mjs              # version from package.json
 *
 * Exit 0 = docs fresh (or prerelease → skipped). Non-zero = stale (names each).
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

// Resolve the version: --version wins, then --tag (strip a leading `v`), then
// package.json. The tag form is what release.yml passes (github.ref_name).
let version = flag('--version');
const tag = flag('--tag');
if (!version && tag) version = tag.replace(/^v/, '');
if (!version) {
  version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`FATAL: "${version}" is not a semver — nothing to gate against.`);
  process.exit(2);
}

// Prerelease (3.15.0-rc.1) → opt-in candidate, doesn't roll the tap → skip.
if (version.includes('-')) {
  console.log(`· ${version} is a prerelease — brew-cut docs gate skipped (candidates don't roll the tap).`);
  process.exit(0);
}

function readMaybe(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const v = escapeRegExp(version);
const problems = [];

const changelog = readMaybe('CHANGELOG.md');
if (changelog == null) {
  problems.push('CHANGELOG.md is missing or unreadable.');
} else if (!new RegExp(`^##\\s*\\[${v}\\]\\s*-\\s*\\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog)) {
  problems.push(`CHANGELOG.md has no dated "## [${version}] - YYYY-MM-DD" section — the release notes were never cut.`);
}

const readme = readMaybe('README.md');
if (readme == null) {
  problems.push('README.md is missing or unreadable.');
} else if (!new RegExp(`Port Daddy \\(v${v}\\)`).test(readme)) {
  problems.push(`README.md title does not advertise v${version} — run \`npx tsx scripts/sync-version.ts\`.`);
}

if (problems.length > 0) {
  console.error(`\n✗ RELEASE DOCS STALE for ${version} — a brew cut must ship fresh docs:`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(`\n  Fix CHANGELOG.md (rename [Unreleased] → [${version}] - YYYY-MM-DD) and README.md,`);
  console.error(`  then re-tag. (Local cuts hit the same gate in \`pd cut\`.)`);
  process.exit(1);
}

console.log(`✓ release docs fresh for ${version} — CHANGELOG section + README title present.`);
