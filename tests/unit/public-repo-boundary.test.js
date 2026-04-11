import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const repoRoot = new URL('../..', import.meta.url);
const boundaryConfig = JSON.parse(
  readFileSync(new URL('../../config/public-repo-boundary.json', import.meta.url), 'utf8'),
);
const gitignoreText = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');

function listTrackedFiles() {
  const output = execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

describe('public repo boundary', () => {
  test('denylisted local residue and model-specific instruction files are not tracked', () => {
    const trackedFiles = listTrackedFiles();
    const patterns = boundaryConfig.denylistedTrackedPathRegexes.map((pattern) => new RegExp(pattern));
    const leakedFiles = trackedFiles.filter((file) => patterns.some((pattern) => pattern.test(file)));

    expect(leakedFiles).toEqual([]);
  });

  test('gitignore still covers the denylisted local-only residue roots', () => {
    for (const entry of boundaryConfig.requiredGitignoreEntries) {
      expect(gitignoreText).toContain(entry);
    }
  });
});
