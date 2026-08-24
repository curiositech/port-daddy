import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * AccountChip contract pins, in the site's source-text style (the same
 * mechanism as public-shell-contracts): the signed-in menu is a static
 * `as const` array with no runtime logic to unit-test, so the durable
 * contract — item order, the relay hrefs, and the untouched signed-out
 * path — is pinned against the source rather than by exporting component
 * internals solely for a test harness.
 */
const accountChipSource = readFileSync(
  fileURLToPath(new URL('./components/site/AccountChip.tsx', import.meta.url)),
  'utf8',
);

describe('AccountChip contracts', () => {
  test('signed-in menu lists runs, account, repo settings, mercy — in that order', () => {
    const menu = /const ACCOUNT_MENU_ITEMS = \[([\s\S]*?)\] as const;/.exec(
      accountChipSource,
    );
    expect(menu, 'ACCOUNT_MENU_ITEMS must stay a single as-const array').not.toBeNull();
    const body = menu![1];
    const labels = [...body.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    expect(labels).toEqual(['Your runs', 'Account', 'Repo settings', 'Mercy report']);
  });

  test('the repo settings entry targets the relay /account/repos screen', () => {
    expect(accountChipSource).toContain(
      '{ label: "Repo settings", href: `${RELAY_ORIGIN}/account/repos` }',
    );
    expect(accountChipSource).toContain(
      'const RELAY_ORIGIN = "https://relay.portdaddy.dev"',
    );
  });

  test('signed-out visitors keep the static sign-in link and graceful degrade', () => {
    expect(accountChipSource).toContain('`${RELAY_ORIGIN}/login`');
    expect(accountChipSource).toContain('data-account-chip="signed-out"');
    // The probe stays the chip's only fetch — one credentialed status call,
    // any failure collapsing to the signed-out link.
    const fetches = accountChipSource.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(accountChipSource).toContain('`${RELAY_ORIGIN}/auth/status`');
  });
});
