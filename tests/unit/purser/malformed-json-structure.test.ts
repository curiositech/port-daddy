// tests/unit/purser/malformed-json-structure.test.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('applied-staging.json ledger integrity', () => {
  // Resolve the absolute path to the ledger file from this test file.
  const ledgerPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    'apps',
    'relay',
    'migrations',
    'applied-staging.json',
  );

  let rawContent: string;
  let parsed: unknown;

  test('file exists and is readable', () => {
    expect(() => {
      rawContent = readFileSync(ledgerPath, 'utf8');
    }).not.toThrow();
    expect(typeof rawContent).toBe('string');
    expect(rawContent.length).toBeGreaterThan(0);
  });

  test('content is valid JSON and is an array', () => {
    expect(() => {
      parsed = JSON.parse(rawContent);
    }).not.toThrow('applied-staging.json must be valid JSON');

    expect(Array.isArray(parsed)).toBe(true);
  });

  test('contains the required migration entry with a proper ISO‑8601 UTC timestamp', () => {
    // At this point `parsed` is known to be an array.
    const ledger = parsed as Array<unknown>;

    // Find the specific migration record.
    const entry = ledger.find(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        'migration' in item &&
        (item as any).migration === '2026-08-26-b3-device-keys.sql',
    ) as { migration: string; appliedAt: string } | undefined;

    expect(entry).toBeDefined();
    expect(entry!.migration).toBe('2026-08-26-b3-device-keys.sql');

    // Validate the timestamp shape.
    expect(typeof entry!.appliedAt).toBe('string');
    const ts = entry!.appliedAt;
    const date = new Date(ts);

    // `Date.parse` returns NaN for invalid dates.
    expect(isNaN(date.getTime())).toBe(false);

    // Ensure the string is the canonical ISO‑8601 UTC representation.
    expect(date.toISOString()).toBe(ts);
  });
});