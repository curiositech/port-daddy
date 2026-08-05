#!/usr/bin/env node
/**
 * Fail-closed release gate for atomic multi-agent documentation council review.
 *
 * The receipt binds distinct reviewer identities and cross-steelman records to
 * a cryptographic digest of the exact candidate tree (excluding receipts to avoid
 * circularity). Any code or docs edit after review invalidates the digest,
 * preventing GitHub Release and Homebrew jobs from shipping a partially reviewed
 * candidate. This gate is fail-closed: absence or validation failure blocks all
 * downstream publication surfaces.
 *
 * Requirements:
 * - 4+ distinct Port Daddy reviewer agents (different identities/roles)
 * - 3+ substantive cross-steelman records from ≥3 different reviewers
 * - All 5 canonical instruction surfaces reviewed
 * - Minor exact-SHA Documentarian receipt
 * - Final synthesis SHIP verdict with zero blockers
 * - Named non-stable feature daemon at exact candidate version
 * - Hashed proof artifacts for visual conformance
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_DIR = 'docs/release-reviews/';

// All five canonical instruction surfaces that must be reviewed before release.
const REQUIRED_SURFACES = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'skills/port-daddy-agent-skill/SKILL.md',
  'skills/port-daddy-internal-dev/SKILL.md',
];

const VERDICTS = new Set(['SHIP', 'SHIP-AFTER-FIX', 'DO-NOT-SHIP']);

// Proof artifacts: visual conformance demos that must be present and unchanged.
const REQUIRED_PROOF_ARTIFACTS = [
  'website-v2/public/demos/harness/harness-conformance-live.gif',
  'website-v2/public/demos/harness/harness-conformance-live-dark.gif',
  'website-v2/public/demos/harness/harness-attention-activation.gif',
  'website-v2/public/demos/harness/harness-attention-activation-dark.gif',
];

/**
 * Compute SHA-256 digest of a single file.
 */
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Compute SHA-256 digest of all candidate tree files.
 * Excludes receipt directory to avoid circular validation.
 * Deterministic order by sorted file paths.
 *
 * @param {string} root Repository root
 * @param {string[]} files Optional pre-computed file list
 * @returns {string} SHA-256 digest in hex
 */
export function digestCandidateTree(root = ROOT, files = candidateFiles(root)) {
  const hash = createHash('sha256');
  for (const path of files) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) throw new Error(`candidate file is missing: ${path}`);
    try {
      const stat = statSync(absolute);
      // Skip directories; only hash regular files
      if (stat.isDirectory()) continue;
    } catch (err) {
      // Skip files with permission errors
      if (err.code === 'EPERM' || err.code === 'EACCES') continue;
      throw err;
    }
    const content = readFileSync(absolute);
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Get all candidate tree files, excluding receipt directory.
 * Uses git ls-files to respect .gitignore.
 *
 * @param {string} root Repository root
 * @returns {string[]} Sorted file paths
 */
export function candidateFiles(root = ROOT) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  );
  return output
    .split('\0')
    .filter(Boolean)
    .filter((path) => !path.startsWith(RECEIPT_DIR))
    .sort();
}

/**
 * Validate a release documentation review receipt against comprehensive rules.
 *
 * Rules enforced:
 * 1. Schema version = 1 (forward compatibility)
 * 2. Release version matches candidate
 * 3. Candidate digest matches current tree (fail-closed on edits)
 * 4. Minor documentation review present with SHIP verdict
 * 5. All 5 canonical surfaces reviewed
 * 6. Proof artifacts present with matching hashes
 * 7. ≥4 unique reviewer agents with valid role/identity/transcript
 * 8. ≥3 cross-steelman records from ≥3 different reviewers
 * 9. No self-review in steelman (prevents theater)
 * 10. Final synthesis SHIP with zero blockers
 * 11. Named daemon at exact version, non-stable label
 * 12. Daemon URL is loopback (127.0.0.1), port-based
 * 13. Daemon binary SHA-256 recorded
 *
 * @param {object} receipt Receipt JSON
 * @param {object} options { version, candidateDigest, root? }
 * @returns {string[]} Array of validation errors (empty = pass)
 */
export function validateReleaseDocReview(receipt, options) {
  const errors = [];
  const expectedRelease = `v${options.version}`;

  // Schema and version
  if (receipt?.schemaVersion !== 1) {
    errors.push('schemaVersion must be 1');
  }
  if (receipt?.release !== expectedRelease) {
    errors.push(`release must equal ${expectedRelease}`);
  }

  // Candidate digest (fail-closed on tree edits)
  if (receipt?.candidateDigest !== options.candidateDigest) {
    errors.push('candidateDigest does not match the current candidate tree (tree has changed since review)');
  }

  // Minor documentation review (push review)
  const pushReview = receipt?.minorDocumentationReview;
  if (!pushReview?.agentId || !pushReview?.transcriptId) {
    errors.push('minorDocumentationReview must record its Port Daddy agent ID and transcript ID');
  }
  if (pushReview?.candidateDigest !== options.candidateDigest) {
    errors.push('minorDocumentationReview must bind the exact candidate tree digest');
  }
  if (pushReview?.verdict !== 'SHIP') {
    errors.push('minorDocumentationReview verdict must be SHIP');
  }

  // Reviewed surfaces (all 5 required)
  const reviewedSurfaces = new Set(receipt?.reviewedSurfaces ?? []);
  for (const surface of REQUIRED_SURFACES) {
    if (!reviewedSurfaces.has(surface)) {
      errors.push(`reviewedSurfaces is missing required surface: ${surface}`);
    }
  }

  // Proof artifacts (visual conformance validation)
  for (const path of REQUIRED_PROOF_ARTIFACTS) {
    const recorded = receipt?.proofArtifacts?.[path];
    if (!/^[0-9a-f]{64}$/.test(String(recorded ?? ''))) {
      errors.push(`proofArtifacts is missing a valid SHA-256 digest for ${path}`);
      continue;
    }
    const absolute = join(options.root ?? ROOT, path);
    if (!existsSync(absolute) || sha256File(absolute) !== recorded) {
      errors.push(`proof artifact hash does not match the candidate tree: ${path}`);
    }
  }

  // Reviewer validation (4+ unique agents required)
  const reviewers = Array.isArray(receipt?.reviewers) ? receipt.reviewers : [];
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer?.agentId).filter(Boolean));
  if (reviewers.length < 4 || reviewerIds.size < 4) {
    errors.push('at least four unique Port Daddy reviewer agent IDs are required');
  }
  for (const reviewer of reviewers) {
    if (!reviewer?.role || !reviewer?.identity || !reviewer?.transcriptId) {
      errors.push(
        `reviewer ${reviewer?.agentId ?? '<missing>'} must have role, identity, and transcriptId`
      );
    }
    if (!VERDICTS.has(reviewer?.verdict)) {
      errors.push(
        `reviewer ${reviewer?.agentId ?? '<missing>'} has invalid verdict: ${reviewer?.verdict}. ` +
        `Allowed: ${Array.from(VERDICTS).join(', ')}`
      );
    }
  }

  // Cross-steelman validation (3+ records from 3+ different reviewers)
  const steelmans = Array.isArray(receipt?.steelman) ? receipt.steelman : [];
  if (steelmans.length < 3) {
    errors.push('at least three substantive cross-steelman records are required');
  }
  const steelmanAuthors = new Set();
  for (const entry of steelmans) {
    steelmanAuthors.add(entry?.reviewerAgentId);
    if (!reviewerIds.has(entry?.reviewerAgentId) || !reviewerIds.has(entry?.targetAgentId)) {
      errors.push(
        'steelman reviewerAgentId and targetAgentId must both name recorded reviewers'
      );
    }
    if (entry?.reviewerAgentId === entry?.targetAgentId) {
      errors.push(
        `a reviewer cannot steelman itself (prevents self-authored theater)`
      );
    }
    const argLen = String(entry?.argument ?? '').length;
    const dispLen = String(entry?.disposition ?? '').length;
    if (argLen < 40 || dispLen < 40) {
      errors.push(
        `steelman record must have substantive argument (${argLen}≥40 chars) ` +
        `and disposition (${dispLen}≥40 chars)`
      );
    }
  }
  if (steelmanAuthors.size < 3) {
    errors.push('steelman records must come from at least three different reviewers');
  }

  // Synthesis validation (final SHIP with zero blockers)
  if (!reviewerIds.has(receipt?.synthesis?.agentId)) {
    errors.push('synthesis.agentId must name one of the recorded reviewers');
  }
  if (receipt?.synthesis?.verdict !== 'SHIP') {
    errors.push('synthesis verdict must be SHIP (final approval)');
  }
  if (!Array.isArray(receipt?.synthesis?.blockers) || receipt.synthesis.blockers.length !== 0) {
    errors.push('synthesis.blockers must be an empty array (all blockers resolved)');
  }

  // Named feature daemon validation
  const daemon = receipt?.namedFeatureDaemon;
  if (!daemon) {
    errors.push('namedFeatureDaemon must be present');
  } else {
    if (daemon.version !== options.version) {
      errors.push(`namedFeatureDaemon.version must match release version ${options.version}`);
    }
    if (daemon.label === 'stable') {
      errors.push('namedFeatureDaemon.label must not be "stable" (use feature-branch name)');
    } else if (!daemon.label) {
      errors.push('namedFeatureDaemon.label must be a non-stable feature branch name');
    }
    if (!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(String(daemon?.url ?? ''))) {
      errors.push(
        'namedFeatureDaemon.url must be an explicit loopback URL (http://127.0.0.1:NNNN)'
      );
    }
    if (!/^[0-9a-f]{64}$/.test(String(daemon?.binarySha256 ?? ''))) {
      errors.push('namedFeatureDaemon.binarySha256 must be a valid SHA-256 digest');
    }
  }

  return errors;
}

/**
 * Parse --version flag or read from package.json.
 *
 * @param {string[]} argv Command-line arguments
 * @returns {string} Version number
 */
function parseVersion(argv) {
  const index = argv.indexOf('--version');
  if (index >= 0 && argv[index + 1]) return argv[index + 1].replace(/^v/, '');
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * Main entry point: validate receipt or compute candidate digest.
 *
 * Usage:
 *   node scripts/check-release-doc-review.mjs
 *   node scripts/check-release-doc-review.mjs --digest
 *   node scripts/check-release-doc-review.mjs --version 3.28.0
 */
function main() {
  const version = parseVersion(process.argv.slice(2));
  if (process.argv.includes('--digest')) {
    console.log(digestCandidateTree(ROOT));
    return;
  }
  const receiptPath = join(ROOT, RECEIPT_DIR, `v${version}.json`);
  if (!existsSync(receiptPath)) {
    console.error(
      `release-doc-review: FAIL\n` +
      `  missing receipt: ${relative(ROOT, receiptPath)}\n` +
      `  Council review required before release.`
    );
    process.exit(1);
  }
  const candidateDigest = digestCandidateTree(ROOT);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const errors = validateReleaseDocReview(receipt, { version, candidateDigest, root: ROOT });
  if (errors.length > 0) {
    console.error(`release-doc-review: FAIL (${errors.length} error${errors.length !== 1 ? 's' : ''})`);
    for (const error of errors) console.error(`  ✗ ${error}`);
    process.exit(1);
  }
  console.log(`✓ release-doc-review: PASS ${receipt.release}`);
  console.log(`  candidate digest: ${candidateDigest}`);
  console.log(`  reviewers: ${new Set(receipt.reviewers.map((r) => r.agentId)).size} unique agents`);
  console.log(`  steelmans: ${receipt.steelman.length} cross-review records`);
  console.log(`  push-review: ${receipt.minorDocumentationReview.agentId}`);
  console.log(`  daemon: ${receipt.namedFeatureDaemon.label} @ ${receipt.namedFeatureDaemon.url}`);
  console.log(`  binary-sha: ${receipt.namedFeatureDaemon.binarySha256.substring(0, 16)}...`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
