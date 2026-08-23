// tests/unit/purser/account-chip-order-contract.test.ts
import { describe, test, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Load the AccountChip source file as a string for static analysis.
 * The path is relative to this test file: tests/unit/purser/... → website-v2/src/components/site/AccountChip.tsx
 */
const accountChipSource = readFileSync(
  fileURLToPath(new URL('../../website-v2/src/components/site/AccountChip.tsx', import.meta.url)),
  'utf8',
);

describe('AccountChip menu contract', () => {
  test('signed‑in menu lists runs, account, repo settings, mercy in that order', () => {
    // Grab the body of the ACCOUNT_MENU_ITEMS array
    const match = /const\s+ACCOUNT_MENU_ITEMS\s*=\s*\[([\s\S]*?)\] as const;/.exec(
      accountChipSource,
    );
    expect(match, 'ACCOUNT_MENU_ITEMS must be a single `as const` array').not.toBeNull();

    const body = match![1];

    // Extract the `label` values in order
    const labels = [...body.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(labels).toEqual(['Your runs', 'Account', 'Repo settings', 'Mercy report']);
  });

  test('repo settings entry targets the relay /account/repos screen', () => {
    // The exact entry must exist in source
    expect(accountChipSource).toContain(
      '{ label: "Repo settings", href: `${RELAY_ORIGIN}/account/repos` }',
    );

    // The relay origin constant must be defined
    expect(accountChipSource).toContain(
      'const RELAY_ORIGIN = "https://relay.portdaddy.dev"',
    );
  });
});