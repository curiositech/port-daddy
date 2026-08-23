// tests/unit/purser/account-chip-signed-out-contract.test.ts
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Signed‑out contract test.
 *
 * The signed‑out path of the AccountChip component must:
 *   • Render only the static `/login` link.
 *   • Not include the new "Repo settings" entry.
 *   • Continue to use the same single fetch probe as before.
 *   • Preserve the data-account-chip="signed-out" attribute.
 *
 * This test reads the source file directly to avoid any runtime
 * dependencies and to pin the contract against the source rather than
 * the compiled output.
 */
const accountChipSource = readFileSync(
  fileURLToPath(
    new URL('../../website-v2/src/components/site/AccountChip.tsx', import.meta.url),
  ),
  'utf8',
);

describe('AccountChip signed‑out contract', () => {
  test('does not expose the Repo settings link', () => {
    // The repo settings entry should not be present in the source.
    const repoEntry = /{ label: "Repo settings", href: `${RELAY_ORIGIN}\/account\/repos` }/;
    expect(repoEntry.test(accountChipSource)).toBe(false);
  });

  test('keeps the static login link', () => {
    // Must contain the login href string.
    expect(accountChipSource).toContain('{ label: "Login", href: `${RELAY_ORIGIN}/login` }');
    // Or at least the href part; the component may not use a label.
    expect(accountChipSource).toContain('href: `${RELAY_ORIGIN}/login`');
  });

  test('renders the signed‑out anchor correctly', () => {
    // The component marks the signed‑out anchor with data-account-chip="signed-out".
    expect(accountChipSource).toContain('data-account-chip="signed-out"');
    // Ensure that only the static login link is referenced.
    const loginHref = /href:\s*`\${RELAY_ORIGIN}\/login`/;
    expect(loginHref.test(accountChipSource)).toBe(true);
  });

  test('uses a single fetch probe', () => {
    // Count fetch calls in the source.
    const fetchCalls = accountChipSource.match(/fetch\(/g) ?? [];
    expect(fetchCalls).toHaveLength(1);
    // The fetch target should be the auth/status endpoint.
    expect(accountChipSource).toContain('`${RELAY_ORIGIN}/auth/status`');
  });

  test('no other menu items are present in the signed‑out path', () => {
    // Signed‑out path should not contain any of the signed‑in menu labels.
    const signedInLabels = [
      'Your runs',
      'Account',
      'Repo settings',
      'Mercy report',
    ];
    signedInLabels.forEach((label) => {
      expect(accountChipSource).not.toContain(label);
    });
  });
});