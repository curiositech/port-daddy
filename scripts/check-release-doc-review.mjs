#!/usr/bin/env node
/**
 * Fail-closed release gate for the major instruction/documentation review.
 *
 * The receipt binds reviewer identities and cross-steelman records to a digest
 * of the entire candidate tree (excluding receipts, which would be circular).
 * A code or docs edit after review invalidates the digest, so GitHub Release
 * and Homebrew jobs cannot ship a partially reviewed candidate.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_DIR = 'docs/release-reviews/';
const REQUIRED_SURFACES = [
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'skills/port-daddy-agent-skill/SKILL.md',
  'skills/port-daddy-internal-dev/SKILL.md',
];
const VERDICTS = new Set(['SHIP', 'SHIP-AFTER-FIX', 'DO-NOT-SHIP']);
const REQUIRED_PROOF_ARTIFACTS = [
  'website-v2/public/demos/harness/harness-conformance-live.gif',
  'website-v2/public/demos/harness/harness-conformance-live-dark.gif',
  'website-v2/public/demos/harness/harness-attention-activation.gif',
  'website-v2/public/demos/harness/harness-attention-activation-dark.gif',
];

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function candidateFiles(root = ROOT) {
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

export function digestCandidateTree(root = ROOT, files = candidateFiles(root)) {
  const hash = createHash('sha256');
  for (const path of files) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) throw new Error(`candidate file is missing: ${path}`);
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

export function validateReleaseDocReview(receipt, options) {
  const errors = [];
  const expectedRelease = `v${options.version}`;
  if (receipt?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (receipt?.release !== expectedRelease) errors.push(`release must equal ${expectedRelease}`);
  if (receipt?.candidateDigest !== options.candidateDigest) {
    errors.push('candidateDigest does not match the current candidate tree');
  }

  const pushReview = receipt?.minorDocumentationReview;
  if (!pushReview?.agentId || !pushReview?.transcriptId) {
    errors.push('minorDocumentationReview must record its Port Daddy agent and transcript');
  }
  if (pushReview?.candidateDigest !== options.candidateDigest) {
    errors.push('minorDocumentationReview must bind the exact candidate tree');
  }
  if (pushReview?.verdict !== 'SHIP') {
    errors.push('minorDocumentationReview verdict must be SHIP');
  }

  const reviewedSurfaces = new Set(receipt?.reviewedSurfaces ?? []);
  for (const surface of REQUIRED_SURFACES) {
    if (!reviewedSurfaces.has(surface)) errors.push(`reviewedSurfaces is missing ${surface}`);
  }

  for (const path of REQUIRED_PROOF_ARTIFACTS) {
    const recorded = receipt?.proofArtifacts?.[path];
    if (!/^[0-9a-f]{64}$/.test(String(recorded ?? ''))) {
      errors.push(`proofArtifacts is missing a SHA-256 for ${path}`);
      continue;
    }
    const absolute = join(options.root ?? ROOT, path);
    if (!existsSync(absolute) || sha256File(absolute) !== recorded) {
      errors.push(`proof artifact hash does not match the candidate: ${path}`);
    }
  }

  const reviewers = Array.isArray(receipt?.reviewers) ? receipt.reviewers : [];
  const reviewerIds = new Set(reviewers.map((reviewer) => reviewer?.agentId).filter(Boolean));
  if (reviewers.length < 4 || reviewerIds.size < 4) {
    errors.push('at least four unique Port Daddy reviewer agent ids are required');
  }
  for (const reviewer of reviewers) {
    if (!reviewer?.role || !reviewer?.identity || !reviewer?.transcriptId) {
      errors.push(`reviewer ${reviewer?.agentId ?? '<missing>'} lacks role, identity, or transcriptId`);
    }
    if (!VERDICTS.has(reviewer?.verdict)) {
      errors.push(`reviewer ${reviewer?.agentId ?? '<missing>'} has invalid verdict`);
    }
  }

  const steelmans = Array.isArray(receipt?.steelman) ? receipt.steelman : [];
  if (steelmans.length < 3) errors.push('at least three cross-review steelman records are required');
  const steelmanAuthors = new Set();
  for (const entry of steelmans) {
    steelmanAuthors.add(entry?.reviewerAgentId);
    if (!reviewerIds.has(entry?.reviewerAgentId) || !reviewerIds.has(entry?.targetAgentId)) {
      errors.push('steelman reviewerAgentId and targetAgentId must name recorded reviewers');
    }
    if (entry?.reviewerAgentId === entry?.targetAgentId) errors.push('a reviewer cannot steelman itself');
    if (String(entry?.argument ?? '').length < 40 || String(entry?.disposition ?? '').length < 40) {
      errors.push('each steelman needs substantive argument and disposition text');
    }
  }
  if (steelmanAuthors.size < 3) errors.push('steelman records must come from at least three reviewers');

  if (!reviewerIds.has(receipt?.synthesis?.agentId)) errors.push('synthesis.agentId must name a recorded reviewer');
  if (receipt?.synthesis?.verdict !== 'SHIP') errors.push('synthesis verdict must be SHIP');
  if (!Array.isArray(receipt?.synthesis?.blockers) || receipt.synthesis.blockers.length !== 0) {
    errors.push('synthesis.blockers must be an empty array');
  }

  const daemon = receipt?.namedFeatureDaemon;
  if (!daemon || daemon.version !== options.version || daemon.label === 'stable') {
    errors.push('namedFeatureDaemon must record a non-stable daemon at the release version');
  }
  if (!/^https?:\/\/127\.0\.0\.1:\d+$/.test(String(daemon?.url ?? ''))) {
    errors.push('namedFeatureDaemon.url must be an explicit loopback feature berth URL');
  }
  if (!/^[0-9a-f]{64}$/.test(String(daemon?.binarySha256 ?? ''))) {
    errors.push('namedFeatureDaemon.binarySha256 must be a sha256 digest');
  }

  return errors;
}

function parseVersion(argv) {
  const index = argv.indexOf('--version');
  if (index >= 0 && argv[index + 1]) return argv[index + 1].replace(/^v/, '');
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

function main() {
  const version = parseVersion(process.argv.slice(2));
  if (process.argv.includes('--digest')) {
    console.log(digestCandidateTree(ROOT));
    return;
  }
  const receiptPath = join(ROOT, RECEIPT_DIR, `v${version}.json`);
  if (!existsSync(receiptPath)) {
    console.error(`release-doc-review: missing ${relative(ROOT, receiptPath)}`);
    process.exit(1);
  }
  const candidateDigest = digestCandidateTree(ROOT);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const errors = validateReleaseDocReview(receipt, { version, candidateDigest, root: ROOT });
  if (errors.length > 0) {
    console.error(`release-doc-review: ${errors.length} failure(s)`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`release-doc-review: PASS ${receipt.release}`);
  console.log(`  candidate ${candidateDigest}`);
  console.log(`  reviewers ${new Set(receipt.reviewers.map((reviewer) => reviewer.agentId)).size}`);
  console.log(`  steelmans ${receipt.steelman.length}`);
  console.log(`  push review ${receipt.minorDocumentationReview.agentId}`);
  console.log(`  daemon ${receipt.namedFeatureDaemon.label} @ ${receipt.namedFeatureDaemon.url}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
