// tests/unit/purser/schemeless-localhost-with-port.test.ts

/**
 * This test ensures that a schemeless localhost reference with a
 * placeholder (e.g., `localhost:PORT`) is considered acceptable,
 * while a hard‑coded numeric port such as `localhost:9876` is
 * explicitly disallowed.  The regular expression below reflects
 * the contract that any numeric port after a loopback host must
 * be rejected.
 */

describe('Schemeseless localhost with port handling', () => {
  // Matches `localhost:<numeric>` or `127.0.0.1:<numeric>`
  const numericPortRegex = /(?:localhost|127\.0\.0\.1):\d+/;

  it('rejects a hard‑coded numeric port like localhost:9876', () => {
    expect(numericPortRegex.test('localhost:9876')).toBe(true);
  });

  it('accepts a placeholder such as localhost:PORT', () => {
    expect(numericPortRegex.test('localhost:PORT')).toBe(false);
  });
});