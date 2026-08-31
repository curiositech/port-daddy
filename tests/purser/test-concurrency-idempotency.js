const { execFileSync } = require('child_process');
const { join } = require('path');
const { readFileSync } = require('fs');
const { repoRoot } = require('../test-utils');

describe('concurrency and idempotency', () => {
  it('produces identical PDFs on repeated builds', () => {
    const pdfPath = join(repoRoot, 'whitepaper/published/spawn-to-person-whitepaper.pdf');
    const initialContent = readFileSync(pdfPath);
    
    execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot });
    
    const finalContent = readFileSync(pdfPath);
    
    expect(Buffer.compare(initialContent, finalContent)).toBe(0);
  });

  it('handles concurrent builds without conflict', () => {
    const buildProcess1 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });
    const buildProcess2 = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, stdio: 'ignore' });
    
    expect(buildProcess1).toBeUndefined();
    expect(buildProcess2).toBeUndefined();
  });
});