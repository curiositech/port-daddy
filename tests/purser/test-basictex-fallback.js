const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../');
const latexmkPath = '/usr/local/bin/latexmk';

// Backup original latexmk
const originalLatexmk = fs.existsSync(latexmkPath) ? fs.readFileSync(latexmkPath) : null;

// Remove latexmk to force fallback
if (fs.existsSync(latexmkPath)) {
  fs.unlinkSync(latexmkPath);
}

try {
  execSync('node scripts/generate-mega-whitepaper.mjs', { cwd: repoRoot, stdio: 'pipe' });
  console.log('Test passed: basicTeX fallback worked');
  process.exit(0);
} catch (error) {
  console.error('Test failed: basicTeX fallback did not work');
  process.exit(1);
} finally {
  // Restore latexmk if it existed
  if (originalLatexmk !== null) {
    fs.writeFileSync(latexmkPath, originalLatexmk);
  }
}
