import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('error handling', () => {
  it('handles missing sources gracefully', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/missing-sources && ../scripts/build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8', stderr: 'pipe' });

    assert.ok(output.includes('No sources found for paper'), 'output must contain "No sources found for paper"');
  });

  it('fails on invalid git commands', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/invalid-git && ../scripts/build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8', stderr: 'pipe' });

    assert.ok(output.includes('Failed to determine paper epoch'), 'output must contain "Failed to determine paper epoch"');
  });
});
