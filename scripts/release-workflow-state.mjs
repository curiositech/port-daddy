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

export function extractFormulaVersion(source) {
  return /^\s*version\s+"([^"]+)"\s*$/m.exec(source)?.[1] ?? null;
}

export function formulaMatchesRelease(source, tag) {
  return extractFormulaVersion(source) === stableVersionFromTag(tag);
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
  ].join('\n');
}

function requireArg(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`missing ${label}\n${usage()}`);
  return value;
}

function main(args) {
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
  throw new Error(`unknown command '${command}'\n${usage()}`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`release-workflow-state: ${error.message}\n`);
    process.exitCode = 1;
  }
}
