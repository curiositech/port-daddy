#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const STABLE_TAG = /^v([0-9]+\.[0-9]+\.[0-9]+)$/;

export function parseStableVersion(value) {
  if (!STABLE_VERSION.test(value)) {
    throw new Error(`'${value}' is not a stable x.y.z version`);
  }
  return value.split('.').map(Number);
}

export function stableVersionFromTag(tag) {
  const match = STABLE_TAG.exec(tag);
  if (!match) {
    throw new Error(`'${tag}' is not a stable vx.y.z tag`);
  }
  return match[1];
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
}

function parseBooleanFlag(value, label) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new Error(`${label} must be true or false`);
}

export function selectTokenSource(hasTrainToken, hasTapToken) {
  if (parseBooleanFlag(hasTrainToken, 'hasTrainToken')) return 'RELEASE_TRAIN_TOKEN';
  if (parseBooleanFlag(hasTapToken, 'hasTapToken')) return 'HOMEBREW_TAP_TOKEN';
  throw new Error('neither RELEASE_TRAIN_TOKEN nor HOMEBREW_TAP_TOKEN is available');
}

export function extractFormulaVersion(source) {
  return /^\s*version\s+"([^"]+)"\s*$/m.exec(source)?.[1] ?? null;
}

export function formulaMatchesRelease(source, tag) {
  return extractFormulaVersion(source) === stableVersionFromTag(tag);
}

const defaultSleep = (delayMs) => new Promise((resolveSleep) => setTimeout(resolveSleep, delayMs));

export async function waitForFormula({
  tag,
  formulaUrl,
  runId = 'release',
  attempts = 180,
  delayMs = 10_000,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
  log = () => {},
}) {
  const version = stableVersionFromTag(tag);
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be a positive integer');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is unavailable');
  }

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestUrl = new URL(formulaUrl);
      requestUrl.searchParams.set('run', runId);
      requestUrl.searchParams.set('attempt', String(attempt));
      const response = await fetchImpl(requestUrl, { headers: { 'Cache-Control': 'no-cache' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (formulaMatchesRelease(await response.text(), tag)) {
        log(`Tap source now advertises Port Daddy ${version} (attempt ${attempt}).`);
        return version;
      }
      log(`Tap has not reached ${tag} yet (attempt ${attempt}/${attempts}).`);
    } catch (error) {
      log(`Tap formula check failed on attempt ${attempt}/${attempts}: ${error.message}`);
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  throw new Error(`tap formula did not reach ${tag} after ${attempts} attempts`);
}

export function selectVersionTransition(version, candidates) {
  parseStableVersion(version);
  const transition = candidates.find(
    (candidate) => candidate.version === version && candidate.parentVersion !== version,
  );
  if (!transition) {
    throw new Error(`could not locate the first package.json transition to ${version}`);
  }
  return transition.sha;
}

function runGit(args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', allowFailure ? 'ignore' : 'inherit'],
    }).trim();
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

export function findVersionTransition(version, range, git = runGit) {
  parseStableVersion(version);
  const revisions = git(['rev-list', '--reverse', range, '--', 'package.json'])
    .split('\n')
    .filter(Boolean);
  const candidates = revisions.map((sha) => {
    const current = JSON.parse(git(['show', `${sha}:package.json`]));
    const parentSource = git(['show', `${sha}^:package.json`], { allowFailure: true });
    const parent = parentSource ? JSON.parse(parentSource) : null;
    return { sha, version: current.version, parentVersion: parent?.version ?? null };
  });
  return selectVersionTransition(version, candidates);
}

function usage() {
  return [
    'usage:',
    '  release-workflow-state.mjs validate-version <x.y.z>',
    '  release-workflow-state.mjs validate-tag <vx.y.z>',
    '  release-workflow-state.mjs newer-than <candidate> <previous>',
    '  release-workflow-state.mjs find-transition <version> <git-range>',
    '  release-workflow-state.mjs formula-matches <tag> <formula-path>',
    '  release-workflow-state.mjs wait-for-formula <tag> <formula-url> [run-id]',
    '  release-workflow-state.mjs require-token <has-train-token> <has-tap-token>',
  ].join('\n');
}

function requireArg(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`missing ${label}\n${usage()}`);
  return value;
}

async function main(args) {
  const command = requireArg(args, 0, 'command');
  if (command === 'validate-version') {
    const version = requireArg(args, 1, 'version');
    parseStableVersion(version);
    process.stdout.write(`${version}\n`);
    return;
  }
  if (command === 'validate-tag') {
    process.stdout.write(`${stableVersionFromTag(requireArg(args, 1, 'tag'))}\n`);
    return;
  }
  if (command === 'newer-than') {
    const candidate = requireArg(args, 1, 'candidate version');
    const previous = requireArg(args, 2, 'previous version');
    if (compareStableVersions(candidate, previous) <= 0) {
      throw new Error(`${candidate} is not newer than ${previous}`);
    }
    process.stdout.write(`${candidate}\n`);
    return;
  }
  if (command === 'find-transition') {
    const version = requireArg(args, 1, 'version');
    const range = requireArg(args, 2, 'git range');
    process.stdout.write(`${findVersionTransition(version, range)}\n`);
    return;
  }
  if (command === 'formula-matches') {
    const tag = requireArg(args, 1, 'tag');
    const formulaPath = requireArg(args, 2, 'formula path');
    if (!formulaMatchesRelease(readFileSync(formulaPath, 'utf8'), tag)) {
      throw new Error(`formula at ${formulaPath} does not advertise ${tag}`);
    }
    process.stdout.write(`${stableVersionFromTag(tag)}\n`);
    return;
  }
  if (command === 'wait-for-formula') {
    const tag = requireArg(args, 1, 'tag');
    const formulaUrl = requireArg(args, 2, 'formula URL');
    const runId = args[3] || 'release';
    const version = await waitForFormula({
      tag,
      formulaUrl,
      runId,
      log: (message) => process.stderr.write(`${message}\n`),
    });
    process.stdout.write(`${version}\n`);
    return;
  }
  if (command === 'require-token') {
    const source = selectTokenSource(
      requireArg(args, 1, 'has-train-token flag'),
      requireArg(args, 2, 'has-tap-token flag'),
    );
    process.stdout.write(`${source}\n`);
    return;
  }
  throw new Error(`unknown command '${command}'\n${usage()}`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`release-workflow-state: ${error.message}\n`);
    process.exitCode = 1;
  });
}
