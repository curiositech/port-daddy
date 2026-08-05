const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

describe('CI Check Failure', () => {
  it('should fail when generated files change', () => {
    const tempDir = path.join(__dirname, 'temp-worktree');
    execSync(`git worktree add ${tempDir} origin/main`, { stdio: 'inherit' });
    
    try {
      process.chdir(tempDir);
      execSync('npm run generate:skill-audit', { stdio: 'inherit' });
      execSync('npm run generate:seo', { stdio: 'inherit' });
      
      // Modify a generated file
      const llmsPath = path.join('website-v2', 'public', 'llms.txt');
      const original = fs.readFileSync(llmsPath, 'utf-8');
      fs.writeFileSync(llmsPath, original + '\n# This is a test change');
      
      // CI check should fail
      expect(() => {
        execSync('npm run prebuild', { stdio: 'inherit' });
      }).toThrow();
    } finally {
      execSync(`git worktree remove ${tempDir}`, { stdio: 'inherit' });
    }
  });
});