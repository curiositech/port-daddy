import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('error handling', () => {
  it('handles missing sources gracefully', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/missing-sources && ../scripts/build-whitepapers.sh paper_epoch'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stderr: 'pipe',
    });
    assert.ok(output.includes('No sources found for paper'), 'Output must indicate missing sources');
  });

  it('fails on invalid git commands', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/invalid-git && ../scripts/build-whitepapers.sh paper_epoch'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stderr: 'pipe',
    });
    assert.ok(output.includes('Failed to determine paper epoch'), 'Output must indicate epoch determination failure');
  });
});