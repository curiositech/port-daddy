const assert = require('assert');
const { generate } = require('../../scripts/generate-mega-whitepaper');

// Mock paper with malformed TeX
const papers = [
  { roman: 'I', prefix: 'ls', title: 'Paper 1', source: 'test/papers/malformed.tex' }
];

// Create test file without \begin{document}
const fs = require('fs');
const path = require('path');

const testDir = path.resolve(__dirname, '../../test/papers');
fs.mkdirSync(testDir, { recursive: true });

fs.writeFileSync(path.join(testDir, 'malformed.tex'), '\end{document}');

// Test that malformed document throws error
assert.throws(() => {
  generate({ papers });
}, /malformed document body/);

// Cleanup
fs.unlinkSync(path.join(testDir, 'malformed.tex'));
fs.rmdirSync(testDir);