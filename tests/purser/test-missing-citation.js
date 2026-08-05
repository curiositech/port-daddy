const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../');
const testPaper = path.join(repoRoot, 'website-v2/public/whitepaper/legible-swarm.tex');

// Add a citation to a non-existent reference
const originalContent = fs.readFileSync(testPaper, 'utf-8');
const modifiedContent = originalContent.replace('\begin{document}', '\begin{document}\cite{nonexistent}');
fs.writeFileSync(testPaper, modifiedContent, 'utf-8');

try {
  execSync('node scripts/generate-mega-whitepaper.mjs', { cwd: repoRoot, stdio: 'pipe' });
  console.error('Test failed: build should have failed due to missing citation');
  process.exit(1);
} catch (error) {
  console.log('Test passed: build correctly failed due to missing citation');
  process.exit(0);
} finally {
  fs.writeFileSync(testPaper, originalContent, 'utf-8');
}
