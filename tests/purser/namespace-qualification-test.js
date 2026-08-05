const assert = require('assert');
const { namespaceLabels } = require('../../scripts/generate-mega-whitepaper');

// Test label namespacing
const testCases = [
  { input: '\label{mylabel}', expected: '\label{ls:mylabel}' },
  { input: '\ref{mylabel}', expected: '\ref{ls:mylabel}' },
  { input: 'label={mylabel}', expected: 'label={ls:mylabel}' }
];

testCases.forEach(({ input, expected }) => {
  const result = namespaceLabels(input, 'ls');
  assert.strictEqual(result, expected, `Failed for input: ${input}`);
});

// Test environment namespacing
const envTest = {
  input: '\begin{exercises}\end{exercises}',
  expected: '\begin{lsexercises}\end{lsexercises}'
};

const envResult = namespaceChapterSyntax(envTest.input, { prefix: 'ls' });
assert.strictEqual(envResult, envTest.expected);