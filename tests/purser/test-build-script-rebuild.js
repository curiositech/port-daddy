import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('build script rebuild logic', () => {
  it('rebuilds all papers on script change', () => {
    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

    // Modify build script
    execFileSync('sh', ['-c', 'echo "// modified" >> scripts/build-whitepapers.sh'], { cwd: repoRoot });

    const finalHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

    assert.notEqual(initialHash, finalHash);

    const buildOutput = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, encoding: 'utf8' });
    assert.ok(
      buildOutput.includes('Rebuilding all papers due to script change'),
      'build output must contain "Rebuilding all papers due to script change"',
    );
  });

  it('does not rebuild on unrelated file change', () => {
    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

    // Modify non-relevant file
    execFileSync('sh', ['-c', 'echo "// test" >> website-v2/src/data/whitePapers.ts'], { cwd: repoRoot });

    const finalHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });

    assert.equal(initialHash, finalHash);

    const buildOutput = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, encoding: 'utf8' });
    assert.ok(
      !buildOutput.includes('Rebuilding all papers'),
      'build output must not contain "Rebuilding all papers"',
    );
  });
});
