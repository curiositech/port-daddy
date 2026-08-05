const assert = require('assert');
const { namespaceLabels } = require('../../scripts/generate-mega-whitepaper');

// Test TikZ label namespacing
const tikzTest = {
  input: 'label={alg:mylabel}',
  expected: 'label={ls:alg:mylabel}'
};

const result = namespaceLabels(tikzTest.input, 'ls');
assert.strictEqual(result, tikzTest.expected, 'TikZ labels should be namespace-qualified');