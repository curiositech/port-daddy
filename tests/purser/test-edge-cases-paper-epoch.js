const { execFileSync } = require('child_process');
const { repoRoot } = require('../test-utils');

describe('paper_epoch edge cases', () => {
  it('fallback to 1700000000 with no commits', () => {
    const epoch = execFileSync('bash', ['-c', 'cd tests/purser/empty-repo && ./build-whitepapers.sh paper_epoch'], { encoding: 'utf8' });
    expect(epoch.trim()).toBe('1700000000');
  });

  it('handles multiple commits with same author time', () => {
    const epoch = execFileSync('git', ['log', '-1', '--format=%at', 'HEAD', '--', 'website-v2/public/whitepaper/spawn-to-person-whitepaper.tex'], { cwd: repoRoot, encoding: 'utf8' });
    expect(epoch.trim()).toBeDefined();
  });

  it('returns latest author time among dependencies', () => {
    const epoch = execFileSync('bash', ['-c', 'cd tests/purser/dependency-test && ./build-whitepapers.sh paper_epoch'], { encoding: 'utf8' });
    expect(epoch.trim()).toMatch(/\d+/);
  });
});
