import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ledgerPath = fileURLToPath(new URL('../../../apps/relay/migrations/applied-staging.json', import.meta.url));

interface StagingMigrationEntry {
  file: string;
  appliedAt: string;
}

function readLedger(): StagingMigrationEntry[] {
  const raw = readFileSync(ledgerPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('applied-staging.json must be a JSON array');
  return parsed as StagingMigrationEntry[];
}

describe('applied-staging.json filename compliance', () => {
  const EXPECTED_FILE = '2026-08-26-b3-device-keys.sql';

  it('is a valid JSON array with no trailing commas (parse succeeds)', () => {
    expect(() => readLedger()).not.toThrow();
  });

  it('contains exactly one entry for the b3-device-keys migration with the exact filename including date prefix', () => {
    const ledger = readLedger();
    const matches = ledger.filter((entry) => entry.file === EXPECTED_FILE);
    expect(matches).toHaveLength(1);
  });

  it('does not match lazy prefixes or substrings (e.g. b3-device-keys.sql without date)', () => {
    const ledger = readLedger();
    expect(ledger.some((entry) => entry.file.includes('b3-device-keys.sql') && entry.file !== EXPECTED_FILE)).toBe(false);
  });

  it('records an immutable ISO 8601 UTC appliedAt timestamp for the migration', () => {
    const ledger = readLedger();
    const entry = ledger.find((e) => e.file === EXPECTED_FILE);
    expect(entry).toBeDefined();
    const { appliedAt } = entry!;
    expect(new Date(appliedAt).toISOString()).toBe(appliedAt);
    expect(appliedAt.endsWith('Z')).toBe(true);
  });

  it('does not allow the handoff gate to be satisfied by a malformed entry (missing file or appliedAt)', () => {
    const ledger = readLedger();
    const entry = ledger.find((e) => e.file === EXPECTED_FILE);
    expect(entry).toBeDefined();
    expect(entry!.file).toBe(EXPECTED_FILE);
    expect(typeof entry!.appliedAt).toBe('string');
    expect(entry!.appliedAt.length).toBeGreaterThan(0);
  });
});