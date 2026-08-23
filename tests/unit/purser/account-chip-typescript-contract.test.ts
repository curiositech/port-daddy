// tests/unit/purser/account-chip-typescript-contract.test.ts
import { describe, expect, test } from '@jest/globals';
import AccountChip from '../../../website-v2/src/components/site/AccountChip';

describe('AccountChip TypeScript contract', () => {
  test('imports without TypeScript errors', () => {
    // Importing the component should compile; if there are TS errors, this test fails at compile time.
    expect(AccountChip).toBeDefined();
  });
});