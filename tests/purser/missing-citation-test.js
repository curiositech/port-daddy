const assert = require('assert');
const { generate } = require('../../scripts/generate-mega-whitepaper');

// Mock paper with missing citation
const papers = [
  { roman: 'I', prefix: 'ls', title: 'Paper 1', source: 'test/papers/missing-cite.tex' }
];

// Create test file with uncited reference
const fs = require('fs');
const path = require('path');

const testDir = path.resolve(__dirname, '../../test/papers');
fs.mkdirSync(testDir, { recursive: true });

fs.writeFileSync(path.join(testDir, 'missing-cite.tex'), '\begin{document}\cite{missing}\end{document}');

// Test that missing citation throws error
assert.throws(() => {
  generate({ papers });
}, /citation missing/);

// Cleanup
fs.unlinkSync(path.join(testDir, 'missing-cite.tex'));
fs.rmdirSync(testDir);