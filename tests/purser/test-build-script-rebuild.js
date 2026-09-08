const { execFileSync } = require('child_process');
const { repoRoot } = require('../test-utils');

describe('build script rebuild logic', () => {
  it('rebuilds all papers on script change', () => {
    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    
    // Modify build script
    execFileSync('sh', ['-c', 'echo "// modified" >> scripts/build-whitepapers.sh'], { cwd: repoRoot });
    
    const finalHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    
    expect(initialHash).not.toBe(finalHash);
    
    const buildOutput = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, encoding: 'utf8' });
    expect(buildOutput).toContain('Rebuilding all papers due to script change');
  });

  it('does not rebuild on unrelated file change', () => {
    const initialHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    
    // Modify non-relevant file
    execFileSync('sh', ['-c', 'echo "// test" >> website-v2/src/data/whitePapers.ts'], { cwd: repoRoot });
    
    const finalHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
    
    expect(initialHash).toBe(finalHash);
    
    const buildOutput = execFileSync('bash', ['-c', 'cd scripts && ./build-whitepapers.sh'], { cwd: repoRoot, encoding: 'utf8' });
    expect(buildOutput).not.toContain('Rebuilding all papers');
  });
});
