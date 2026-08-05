const assert = require('assert');
const { generate } = require('../../scripts/generate-mega-whitepaper');

// Mock papers with cyclic import
const papers = [
  { roman: 'I', prefix: 'ls', title: 'Paper 1', source: 'test/papers/cycle1.tex' },
  { roman: 'II', prefix: 'swk', title: 'Paper 2', source: 'test/papers/cycle2.tex' }
];

// Create cyclic test files
const fs = require('fs');
const path = require('path');

const testDir = path.resolve(__dirname, '../../test/papers');
fs.mkdirSync(testDir, { recursive: true });

// cycle1.tex includes cycle2.tex
fs.writeFileSync(path.join(testDir, 'cycle1.tex'), '\input{cycle2.tex}');
// cycle2.tex includes cycle1.tex
fs.writeFileSync(path.join(testDir, 'cycle2.tex'), '\input{cycle1.tex}');

// Test that cyclic import throws error
assert.throws(() => {
  generate({ papers });
}, /cyclic TeX import/);

// Cleanup
fs.unlinkSync(path.join(testDir, 'cycle1.tex'));
fs.unlinkSync(path.join(testDir, 'cycle2.tex'));
fs.rmdirSync(testDir);