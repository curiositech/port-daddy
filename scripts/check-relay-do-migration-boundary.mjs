#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const FULL_SHA = /^[0-9a-f]{40}$/;
const MIGRATION_TAG = /^[A-Za-z0-9._-]+$/;
const CONFIG_PATH = 'apps/relay/wrangler.deploy.toml';
const D1_MIGRATIONS_PATH = 'apps/relay/migrations';

/**
 * Require an immutable, lower-case Git object id instead of a branch or short
 * revision. The design intent is to make a production dispatch reviewable
 * before it runs and immune to a ref moving between validation and checkout.
 *
 * @param {string} name Human-readable input name for failures.
 * @param {string} value Candidate Git object id.
 * @returns {string} The validated full object id.
 */
export function validateFullSha(name, value) {
  if (!FULL_SHA.test(value)) {
    throw new Error(`${name} must be a full 40-character lower-case commit SHA`);
  }
  return value;
}

/**
 * Parse only top-level legacy `[[migrations]]` blocks from a Wrangler TOML
 * document. This purposefully small parser treats every new TOML section as a
 * boundary; it does not guess across environments or unrelated arrays.
 *
 * @param {string} source Wrangler TOML source.
 * @returns {Array<{tag: string, lifecycleKeys: string[]}>} Ordered migration summaries.
 */
export function parseLegacyDurableObjectMigrations(source) {
  const blocks = [];
  let current = null;

  const finish = () => {
    if (!current) return;
    const body = current.join('\n');
    const tag = body.match(/^\s*tag\s*=\s*"([^"]+)"\s*$/m)?.[1];
    if (!tag) throw new Error('every [[migrations]] block must contain a quoted tag');
    const lifecycleKeys = [...body.matchAll(
      /^\s*(new_classes|new_sqlite_classes|renamed_classes|deleted_classes)\s*=/gm,
    )].map((match) => match[1]);
    blocks.push({ tag, lifecycleKeys });
    current = null;
  };

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*\[\[migrations\]\]\s*$/.test(line)) {
      finish();
      current = [];
      continue;
    }
    if (current && /^\s*\[\[?.+\]\]?\s*$/.test(line)) {
      finish();
    }
    if (current) current.push(line);
  }
  finish();

  const tags = blocks.map(({ tag }) => tag);
  if (new Set(tags).size !== tags.length) {
    throw new Error('Durable Object migration tags must be unique');
  }
  return blocks;
}

/**
 * Prove that a candidate config adds exactly one legacy Durable Object
 * lifecycle operation while preserving the deployed migration prefix. The
 * motivation is Cloudflare's atomic lifecycle contract: this lane must never
 * become a generic historical-code deployment escape hatch.
 *
 * @param {{baselineSource: string, candidateSource: string, expectedTag: string}} input Config pair and expected tag.
 * @returns {{baselineTags: string[], candidateTags: string[], added: {tag: string, lifecycleKeys: string[]}}} Boundary evidence.
 */
export function validateMigrationSequence({ baselineSource, candidateSource, expectedTag }) {
  if (!MIGRATION_TAG.test(expectedTag)) {
    throw new Error('expected migration tag must contain only letters, digits, dot, underscore, or hyphen');
  }
  const baseline = parseLegacyDurableObjectMigrations(baselineSource);
  const candidate = parseLegacyDurableObjectMigrations(candidateSource);
  const baselineTags = baseline.map(({ tag }) => tag);
  const candidateTags = candidate.map(({ tag }) => tag);

  if (candidate.length !== baseline.length + 1) {
    throw new Error('candidate must add exactly one Durable Object migration block');
  }
  if (baselineTags.some((tag, index) => candidateTags[index] !== tag)) {
    throw new Error('candidate must preserve the baseline Durable Object migration prefix');
  }
  const added = candidate.at(-1);
  if (added.tag !== expectedTag) {
    throw new Error(`candidate adds ${added.tag}, expected ${expectedTag}`);
  }
  if (added.lifecycleKeys.length === 0) {
    throw new Error(`migration ${expectedTag} has no Durable Object lifecycle operation`);
  }
  return { baselineTags, candidateTags, added };
}

/**
 * Run Git without a shell and return its exact stdout. Argument arrays are a
 * deliberate safety boundary because deployment inputs must never become
 * executable shell fragments.
 *
 * @param {string[]} args Git arguments.
 * @param {{allowFailure?: boolean}} options Failure policy.
 * @returns {{status: number, stdout: string, stderr: string}} Git result.
 */
function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  const status = result.status ?? 1;
  if (!allowFailure && status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Validate repository ancestry, Wrangler migration sequence, and the absence
 * of D1 schema changes in the atomic Durable Object interval. The returned
 * evidence is printed by CI so a reviewer can reconstruct the cutover.
 *
 * @param {{baselineSha: string, migrationSha: string, expectedTag: string}} input Dispatch inputs.
 * @param {(args: string[], options?: {allowFailure?: boolean}) =>
 *   {status: number, stdout: string, stderr: string}} runGitCommand Git runner;
 *   injectable only so failure boundaries are deterministic in tests.
 * @returns {{baselineSha: string, migrationSha: string, expectedTag: string, baselineMigrationTag: string | null, candidateMigrationTag: string, relayFilesChanged: string[], lifecycleKeys: string[]}} Auditable evidence.
 */
export function validateRepositoryBoundary(
  { baselineSha, migrationSha, expectedTag },
  runGitCommand = runGit,
) {
  validateFullSha('baseline_sha', baselineSha);
  validateFullSha('migration_sha', migrationSha);

  for (const sha of [baselineSha, migrationSha]) {
    if (runGitCommand(['merge-base', '--is-ancestor', sha, 'origin/main'], { allowFailure: true }).status !== 0) {
      throw new Error(`${sha} is not an ancestor of origin/main`);
    }
  }
  if (runGitCommand(['merge-base', '--is-ancestor', baselineSha, migrationSha], { allowFailure: true }).status !== 0) {
    throw new Error('baseline_sha must be an ancestor of migration_sha');
  }

  const baselineSource = runGitCommand(['show', `${baselineSha}:${CONFIG_PATH}`]).stdout;
  const candidateSource = runGitCommand(['show', `${migrationSha}:${CONFIG_PATH}`]).stdout;
  const sequence = validateMigrationSequence({ baselineSource, candidateSource, expectedTag });

  const d1Changes = runGitCommand([
    'diff', '--name-only', `${baselineSha}..${migrationSha}`, '--', D1_MIGRATIONS_PATH,
  ]).stdout.trim();
  if (d1Changes) {
    throw new Error(`D1 migrations belong to the staging-first lane, not this atomic lane: ${d1Changes}`);
  }

  const relayFilesChanged = runGitCommand([
    'diff', '--name-only', `${baselineSha}..${migrationSha}`, '--', 'apps/relay',
  ]).stdout.trim().split('\n').filter(Boolean);
  if (relayFilesChanged.length === 0) {
    throw new Error('migration interval changes no Relay files');
  }

  return {
    baselineSha,
    migrationSha,
    expectedTag,
    baselineMigrationTag: sequence.baselineTags.at(-1) ?? null,
    candidateMigrationTag: sequence.candidateTags.at(-1),
    relayFilesChanged,
    lifecycleKeys: sequence.added.lifecycleKeys,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [baselineSha = '', migrationSha = '', expectedTag = ''] = process.argv.slice(2);
  try {
    const evidence = validateRepositoryBoundary({ baselineSha, migrationSha, expectedTag });
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`relay-do-migration-boundary: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
