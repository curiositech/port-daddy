const { execFileSync } = require('child_process');
const { repoRoot } = require('../test-utils');

describe('error handling', () => {
  it('handles missing sources gracefully', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/missing-sources && ../scripts/build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8', stderr: 'pipe' });
    
    expect(output).toContain('No sources found for paper');
  });

  it('fails on invalid git commands', () => {
    const output = execFileSync('bash', ['-c', 'cd tests/purser/invalid-git && ../scripts/build-whitepapers.sh paper_epoch'], { cwd: repoRoot, encoding: 'utf8', stderr: 'pipe' });
    
    expect(output).toContain('Failed to determine paper epoch');
  });
});
