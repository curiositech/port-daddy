const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../');
const testDir = path.join(repoRoot, 'tests/purser/cyclic-test');
fs.mkdirSync(testDir, { recursive: true });

// Create cyclic import files
const fileA = path.join(testDir, 'a.tex');
const fileB = path.join(testDir, 'b.tex');
fs.writeFileSync(fileA, `\input{b.tex}\begin{document} A \end{document}`);
fs.writeFileSync(fileB, `\input{a.tex}\begin{document} B \end{document}`);

try {
  execSync(`node scripts/generate-mega-whitepaper.mjs ${testDir}`, { cwd: repoRoot, stdio: 'pipe' });
  console.error('Test failed: build should have failed due to cyclic imports');
  process.exit(1);
} catch (error) {
  console.log('Test passed: build correctly failed due to cyclic imports');
  process.exit(0);
} finally {
  fs.rmSync(testDir, { recursive: true });
}
