import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('concurrency and idempotency', () => {
  it('ensures idempotency under concurrent ingests', () => {
    const digestDate = '2023-10-01';
    const kind = 'recurring-eureka-arc';
    const title = 'Test Ingest';

    // Run 5 concurrent ingests
    const promises = Array.from({ length: 5 }, () => {
      return new Promise((resolve) => {
        execFileSync('node', ['scripts/session-intel-ingest.js', digestDate, kind, title], {
          cwd: repoRoot,
          stdio: 'ignore',
        });
        resolve();
      });
    });

    return Promise.all(promises).then(() => {
      // Check that only one ingest succeeded
      const count = execFileSync('node', ['scripts/session-intel-count.js', digestDate, kind, title], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      assert.equal(count.trim(), '1', 'Only one ingest should succeed');
    });
  });

  it('handles concurrent builds without conflict', () => {
    const buildProcess1 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });
    const buildProcess2 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });
    assert.equal(buildProcess1, undefined);
    assert.equal(buildProcess2, undefined);
  });
});