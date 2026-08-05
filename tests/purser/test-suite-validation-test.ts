import { test, expect } from 'vitest';
import { runTest } from '../scripts/utils';

test('Ensure all test suites pass as required', async () => {
  // Verify whitePapers.test.ts passes 9/9 tests
  const whitePapersResult = await runTest('website-v2/src/data/whitePapers.test.ts');
  expect(whitePapersResult.passingTests).toBe(9);
  
  // Verify spawn-whitepaper-contract.test.js passes 6/6 checks
  const contractResult = await runTest('tests/unit/spawn-whitepaper-contract.test.js');
  expect(contractResult.passingTests).toBe(6);
});