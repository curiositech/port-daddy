const assert = require('assert');
const { generate } = require('../../scripts/generate-mega-whitepaper');

// Test manifest contains all seven sources
const papers = [
  { roman: 'I', prefix: 'ls', title: 'Paper 1', source: 'test/papers/p1.tex' },
  { roman: 'II', prefix: 'swk', title: 'Paper 2', source: 'test/papers/p2.tex' },
  { roman: 'III', prefix: 'stp', title: 'Paper 3', source: 'test/papers/p3.tex' },
  { roman: 'IV', prefix: 'he', title: 'Paper 4', source: 'test/papers/p4.tex' },
  { roman: 'V', prefix: 'anchor', title: 'Paper 5', source: 'test/papers/p5.tex' },
  { roman: 'VI', prefix: 'bonded', title: 'Paper 6', source: 'test/papers/p6.tex' },
  { roman: 'VII', prefix: 'fh', title: 'Paper 7', source: 'test/papers/p7.tex' }
];

// Create dummy test files
const fs = require('fs');
const path = require('path');

const testDir = path.resolve(__dirname, '../../test/papers');
fs.mkdirSync(testDir, { recursive: true });

for (let i = 1; i <= 7; i++) {
  fs.writeFileSync(path.join(testDir, `p${i}.tex`), '\begin{document}\end{document}');
}

// Run generator and check manifest
const manifestPath = path.resolve(__dirname, '../../.cache/whitepaper-build/coordination-papers-mega-volume/mega-volume-generation.json');

generate({ papers });

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.chapters, 7, 'Manifest should list 7 chapters');
assert.strictEqual(manifest.references, 0, 'References should be 0 until processed');
assert.strictEqual(manifest.sources.length, 7, 'Manifest should list all 7 sources');

// Cleanup
for (let i = 1; i <= 7; i++) {
  fs.unlinkSync(path.join(testDir, `p${i}.tex`));
}
fs.rmdirSync(testDir);