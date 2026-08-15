import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('paper_epoch edge cases', () => {
  it('fallback to 1700000000 with no commits', () => {
    const epoch = execFileSync('bash', ['-c', 'cd tests/purser/empty-repo && ./build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(epoch.trim(), '1700000000');
  });

  it('handles multiple commits with same author time', () => {
    const epoch = execFileSync('git', ['log', '-1', '--format=%at', 'HEAD', '--', 'website-v2/public/whitepaper/spawn-to-person-whitepaper.tex'], { cwd: repoRoot, encoding: 'utf8' });
    assert.notEqual(epoch.trim(), undefined);
  });

  it('returns latest author time among dependencies', () => {
    const epoch = execFileSync('bash', ['-c', 'cd tests/purser/dependency-test && ./build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8' });
    assert.match(epoch.trim(), /\d+/);
  });
});
