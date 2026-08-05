const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../');
const testPaper = 'nonexistent-paper.tex';

// Modify papers array to include a missing source
const originalPapers = require('../../scripts/generate-mega-whitepaper.mjs').papers;
const corruptedPapers = [...originalPapers, { roman: 'VIII', prefix: 'x', title: 'Broken Paper', source: testPaper }];

// Patch the generator to use corrupted papers
const generatorPath = path.resolve(repoRoot, 'scripts/generate-mega-whitepaper.mjs');
let generatorContent = fs.readFileSync(generatorPath, 'utf-8');
generatorContent = generatorContent.replace('const papers = [', `const papers = ${JSON.stringify(corruptedPapers, null, 2)};
`);
fs.writeFileSync(generatorPath, generatorContent, 'utf-8');

try {
  execSync('node scripts/generate-mega-whitepaper.mjs', { cwd: repoRoot, stdio: 'pipe' });
  console.error('Test failed: build should have failed due to missing paper source');
  process.exit(1);
} catch (error) {
  console.log('Test passed: build correctly failed due to missing paper source');
  process.exit(0);
} finally {
  // Restore original generator
  fs.writeFileSync(generatorPath, originalPapersContent, 'utf-8');
}
