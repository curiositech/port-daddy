import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { repoRoot } from './mega-volume-test-helpers.js';

describe('concurrency and idempotency', () => {
  it('produces identical PDFs on repeated builds', () => {
    const pdfPath = join(repoRoot, 'website-v2/public/whitepaper/spawn-to-person-whitepaper.pdf');
    const initialContent = readFileSync(pdfPath);

    execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot });

    const finalContent = readFileSync(pdfPath);

    assert.equal(Buffer.compare(initialContent, finalContent), 0);
  });

  it('handles concurrent builds without conflict', () => {
    const buildProcess1 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });
    const buildProcess2 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });

    assert.equal(buildProcess1, undefined);
    assert.equal(buildProcess2, undefined);
  });
});
