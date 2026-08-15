import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('append-only projection', () => {
  it('prevents projection shrinkage', () => {
    const output = execFileSync('node', ['scripts/validate-roadmap-snapshot.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stderr: 'pipe',
    });
    assert.match(output, /Projection shrinkage detected/, 'Projection shrinkage should be blocked');
  });
});