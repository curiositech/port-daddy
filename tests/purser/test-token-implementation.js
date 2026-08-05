const fs = require('fs');
const path = require('path');

const tokensPath = path.join(__dirname, '../../website-v2/tokens.source.css');
const tokensContent = fs.readFileSync(tokensPath, 'utf-8');

// Test 1: Check all fractional linework tokens exist
const lineworkTokens = ['--lw-1px', '--lw-1.5px', '--lw-2px', '--lw-3px'];
lineworkTokens.forEach(token => {
  expect(tokensContent).toContain(token);
});

// Test 2: Check role aliases exist
const roleAliases = ['--error', '--success', '--warning', '--info'];
roleAliases.forEach(alias => {
  expect(tokensContent).toContain(alias);
});

// Test 3: Check surface-card well implementation
expect(tokensContent).toContain('--surface-card');
expect(tokensContent).toContain('hairline');