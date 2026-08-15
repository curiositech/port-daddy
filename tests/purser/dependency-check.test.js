import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('dependency checking', () => {
  it('detects missing dependencies', () => {
    const output = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh --changed-since=nonexistent'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stderr: 'pipe',
    });
    assert.ok(output.includes('No changes detected'), 'Output must indicate no changes');
  });
});