const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('Regeneration Idempotency', () => {
  it('should produce identical output on repeated runs', () => {
    const tempDir = path.join(__dirname, 'temp-worktree');
    execSync(`git worktree add ${tempDir} origin/main`, { stdio: 'inherit' });
    
    try {
      process.chdir(tempDir);
      execSync('npm run generate:skill-audit', { stdio: 'inherit' });
      execSync('npm run generate:seo', { stdio: 'inherit' });
      
      const diff = execSync('git diff --exit-code website-v2/public/skill-audit.json website-v2/public/llms.txt', { stdio: 'pipe' });
      expect(diff.toString()).toBe('');
    } finally {
      execSync(`git worktree remove ${tempDir}`, { stdio: 'inherit' });
    }
  });
});