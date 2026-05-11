#!/usr/bin/env node
/**
 * Sign + notarize a Port Daddy Mach-O binary for macOS distribution.
 *
 * Wraps the recipe proven during the ADR-0028 spike:
 *   1. codesign --options runtime --timestamp --entitlements <plist>
 *      --sign "Developer ID Application: <team>"
 *   2. ditto -c -k --keepParent <bin> <bin>.zip
 *   3. xcrun notarytool submit <zip> --keychain-profile <profile> --wait
 *   4. stapler validate (where applicable; raw Mach-O CLI binaries rely on
 *      Apple's online ticket lookup, not stapling)
 *   5. spctl --assess --type install -> verify "Notarized Developer ID"
 *
 * Usage:
 *   node scripts/sign-and-notarize.mjs <path-to-binary> [--manifest <out.json>]
 *
 * Required env:
 *   PORT_DADDY_SIGN_IDENTITY     codesign identity, e.g.
 *                                "Developer ID Application: Curiositech LLC (P5H9P59X2M)"
 *   PORT_DADDY_NOTARY_PROFILE    xcrun notarytool --keychain-profile name
 *                                (created via `xcrun notarytool store-credentials`)
 *
 * Optional env:
 *   PORT_DADDY_ENTITLEMENTS      Path to entitlements plist. Defaults to
 *                                scripts/entitlements/port-daddy.plist which
 *                                contains the Bun-JIT entitlement set:
 *                                cs.allow-jit + cs.allow-unsigned-executable-memory
 *                                + cs.disable-library-validation.
 *   PORT_DADDY_SKIP_NOTARIZE     If set to "1", sign only (no notarytool submit).
 *                                For local dev/test where you don't want to
 *                                spend an Apple notarization slot.
 *
 * Exit codes:
 *   0  success (signed + notarized + Gatekeeper-accepted)
 *   1  invocation error (missing args/env)
 *   2  codesign failed
 *   3  notarytool submission failed or status != Accepted
 *   4  spctl assessment failed
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENTITLEMENTS = join(ROOT_DIR, 'scripts', 'entitlements', 'port-daddy.plist');

function readArg(name) {
  const idx = process.argv.findIndex(a => a === name);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function run(command, args, { allowFail = false } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0 && !allowFail) {
    process.stderr.write(`${command} ${args.join(' ')}\n`);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw Object.assign(new Error(`${command} exited with ${result.status}`), { stdoutText: result.stdout, stderrText: result.stderr });
  }
  return result;
}

const binary = process.argv[2];
if (!binary || binary.startsWith('-')) {
  process.stderr.write('Usage: sign-and-notarize.mjs <binary> [--manifest <out.json>]\n');
  process.exit(1);
}
const binaryPath = resolve(binary);
if (!existsSync(binaryPath)) {
  process.stderr.write(`Binary not found: ${binaryPath}\n`);
  process.exit(1);
}

const signIdentity = process.env.PORT_DADDY_SIGN_IDENTITY;
if (!signIdentity) {
  process.stderr.write('PORT_DADDY_SIGN_IDENTITY env var required (e.g. "Developer ID Application: Curiositech LLC (P5H9P59X2M)")\n');
  process.exit(1);
}

const entitlements = process.env.PORT_DADDY_ENTITLEMENTS || DEFAULT_ENTITLEMENTS;
if (!existsSync(entitlements)) {
  process.stderr.write(`Entitlements plist not found: ${entitlements}\n`);
  process.stderr.write('Bun-compiled binaries require the JIT entitlement set. See scripts/entitlements/port-daddy.plist.\n');
  process.exit(1);
}

const manifestPath = readArg('--manifest');
const skipNotarize = process.env.PORT_DADDY_SKIP_NOTARIZE === '1';

const manifest = {
  binary: binaryPath,
  signIdentity,
  entitlements,
  startedAt: new Date().toISOString(),
  steps: {},
};

// 1. codesign
process.stderr.write(`Signing ${binaryPath} with hardened runtime + JIT entitlements...\n`);
try {
  run('codesign', [
    '--force',
    '--options', 'runtime',
    '--timestamp',
    '--entitlements', entitlements,
    '--sign', signIdentity,
    binaryPath,
  ]);
} catch (err) {
  manifest.steps.codesign = { status: 'failed', error: err.stderrText || err.message };
  if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.exit(2);
}

// Verify signature was attached correctly.
const verify = run('codesign', ['-dvv', binaryPath], { allowFail: true });
const verifyOutput = (verify.stderr || '') + (verify.stdout || '');
const teamMatch = verifyOutput.match(/TeamIdentifier=(\S+)/);
const authorityMatch = verifyOutput.match(/Authority=(Developer ID Application: [^\n]+)/);

manifest.steps.codesign = {
  status: 'ok',
  teamIdentifier: teamMatch ? teamMatch[1] : null,
  authority: authorityMatch ? authorityMatch[1] : null,
};

if (skipNotarize) {
  manifest.steps.notarize = { status: 'skipped', reason: 'PORT_DADDY_SKIP_NOTARIZE=1' };
  manifest.finishedAt = new Date().toISOString();
  if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.stderr.write('Signed only. Skipping notarization.\n');
  process.exit(0);
}

const notaryProfile = process.env.PORT_DADDY_NOTARY_PROFILE;
if (!notaryProfile) {
  process.stderr.write('PORT_DADDY_NOTARY_PROFILE env var required for notarization\n');
  process.stderr.write('Create one with: xcrun notarytool store-credentials <profile-name>\n');
  process.exit(1);
}

// 2. Zip for notarytool submission. Apple wants a .zip / .pkg / .dmg, not a
//    raw Mach-O. ditto preserves codesign metadata across the archive.
const zipDir = mkdirSync(join(tmpdir(), `pd-notarize-${process.pid}`), { recursive: true });
const zipPath = join(zipDir || tmpdir(), `${binaryPath.split('/').pop()}.zip`);
process.stderr.write(`Packaging ${binaryPath} -> ${zipPath}\n`);
run('ditto', ['-c', '-k', '--keepParent', binaryPath, zipPath]);

// 3. Submit to notarytool, blocking until Apple returns a verdict.
process.stderr.write(`Submitting to notarytool (profile: ${notaryProfile})...\n`);
const submit = run('xcrun', [
  'notarytool', 'submit', zipPath,
  '--keychain-profile', notaryProfile,
  '--wait',
  '--output-format', 'plist',
], { allowFail: true });
const submitOutput = submit.stdout + submit.stderr;

const idMatch = submitOutput.match(/<key>id<\/key>\s*<string>([^<]+)<\/string>/);
const statusMatch = submitOutput.match(/<key>status<\/key>\s*<string>([^<]+)<\/string>/);
const submissionId = idMatch ? idMatch[1] : null;
const submissionStatus = statusMatch ? statusMatch[1] : null;

manifest.steps.notarize = {
  status: submissionStatus === 'Accepted' ? 'ok' : 'failed',
  submissionId,
  appleStatus: submissionStatus,
  rawOutput: submitOutput.slice(0, 2000),
};

if (submissionStatus !== 'Accepted') {
  process.stderr.write(`Notarization not Accepted: ${submissionStatus}\n`);
  if (submissionId) {
    process.stderr.write(`Inspect log: xcrun notarytool log ${submissionId} --keychain-profile ${notaryProfile}\n`);
  }
  if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.exit(3);
}

// 4. Stapler — works for .app / .pkg / .dmg / .zip-of-app, NOT raw Mach-O.
//    For raw Mach-O CLI binaries, Apple's online ticket lookup is what
//    Gatekeeper actually consults. Stapling is a nice-to-have for offline.
const stapleAttempt = run('xcrun', ['stapler', 'staple', binaryPath], { allowFail: true });
manifest.steps.staple = {
  status: stapleAttempt.status === 0 ? 'ok' : 'skipped',
  reason: stapleAttempt.status === 0
    ? 'stapled'
    : 'raw Mach-O does not support stapling; online ticket lookup will be used',
};

// 5. Verify with Gatekeeper.
const spctl = run('spctl', ['--assess', '--type', 'install', '--verbose', binaryPath], { allowFail: true });
const spctlOutput = (spctl.stdout || '') + (spctl.stderr || '');
const accepted = /accepted/.test(spctlOutput);
const sourceMatch = spctlOutput.match(/source=(.+)/);

manifest.steps.gatekeeper = {
  status: accepted ? 'ok' : 'failed',
  source: sourceMatch ? sourceMatch[1].trim() : null,
  raw: spctlOutput.trim(),
};

if (!accepted) {
  process.stderr.write(`spctl assess rejected ${binaryPath}:\n${spctlOutput}\n`);
  if (manifestPath) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.exit(4);
}

manifest.finishedAt = new Date().toISOString();

if (manifestPath) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

process.stdout.write(JSON.stringify({
  binary: binaryPath,
  team: manifest.steps.codesign.teamIdentifier,
  submissionId,
  gatekeeper: manifest.steps.gatekeeper.source,
}, null, 2) + '\n');
