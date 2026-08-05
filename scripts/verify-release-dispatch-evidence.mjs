#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const FULL_SHA = /^[0-9a-f]{40}$/;
const RELEASE_TAG = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

export const RELEASE_ARCHIVES = Object.freeze([
  {
    platform: 'darwin',
    archive: 'pd-darwin-arm64.tar.gz',
    imprint: 'pd-darwin-arm64-imprint.json',
  },
  {
    platform: 'linux',
    archive: 'pd-linux-x64.tar.gz',
    imprint: 'pd-linux-x64-imprint.json',
  },
]);

function fail(message) {
  throw new Error(`release dispatch evidence rejected: ${message}`);
}

/**
 * Reduce complete Batten imprints to the immutable evidence the tap must
 * independently re-check before mutating its formula.
 */
export function verifyReleaseDispatchEvidence({ version, candidateSha, imprints }) {
  if (!RELEASE_TAG.test(version ?? '')) fail('version must be an exact v-prefixed semantic release tag');
  const normalizedSha = (candidateSha ?? '').toLowerCase();
  if (!FULL_SHA.test(normalizedSha)) fail('candidate SHA must be a full 40-character commit');
  if (!imprints || typeof imprints !== 'object') fail('imprints are required');

  const result = {
    version,
    candidate_sha: normalizedSha,
  };

  for (const expected of RELEASE_ARCHIVES) {
    const imprint = imprints[expected.imprint];
    if (!imprint || typeof imprint !== 'object') fail(`missing ${expected.imprint}`);
    if ((imprint.sourceCommit ?? '').toLowerCase() !== normalizedSha) {
      fail(`${expected.imprint} sourceCommit does not match the reviewed candidate`);
    }
    if (imprint.releaseVersion !== version) {
      fail(`${expected.imprint} releaseVersion does not match ${version}`);
    }
    if (!Array.isArray(imprint.missingRequired) || imprint.missingRequired.length !== 0) {
      fail(`${expected.imprint} is incomplete`);
    }
    const archives = Array.isArray(imprint.archives)
      ? imprint.archives.filter((entry) => entry?.name === expected.archive)
      : [];
    if (archives.length !== 1) fail(`${expected.imprint} must seal exactly one ${expected.archive}`);
    const archive = archives[0];
    const digest = (archive.sha256 ?? '').toLowerCase();
    if (!SHA256.test(digest) || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0) {
      fail(`${expected.imprint} has invalid archive evidence`);
    }
    result[`${expected.platform}_archive_sha256`] = digest;
  }

  return result;
}

function valueAfter(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function runCli(argv = process.argv.slice(2), env = process.env) {
  const version = valueAfter(argv, '--version');
  const candidateSha = valueAfter(argv, '--candidate-sha');
  const imprintDir = valueAfter(argv, '--imprint-dir');
  if (!imprintDir) fail('--imprint-dir is required');

  const imprints = Object.fromEntries(RELEASE_ARCHIVES.map(({ imprint }) => {
    const path = join(imprintDir, imprint);
    return [imprint, JSON.parse(readFileSync(path, 'utf8'))];
  }));
  const evidence = verifyReleaseDispatchEvidence({ version, candidateSha, imprints });
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, Object.entries(evidence)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''));
  } else {
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
