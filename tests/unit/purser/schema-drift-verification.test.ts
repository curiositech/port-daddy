import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEDGER_RELATIVE_PATH = '../../../apps/relay/migrations/applied-staging.json';

interface StagingMigrationEntry {
  file: string;
  appliedAt: string;
}

const MIGRATION_FILE_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/;
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

function readLedger(): StagingMigrationEntry[] {
  const ledgerPath = resolve(dirname(fileURLToPath(import.meta.url)), LEDGER_RELATIVE_PATH);
  const raw = readFileSync(ledgerPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('applied-staging.json must contain a JSON array at the top level');
  }
  return parsed as StagingMigrationEntry[];
}

describe('applied-staging.json migration ledger schema', () => {
  let ledger: StagingMigrationEntry[];

  beforeAll(() => {
    ledger = readLedger();
  });

  test('parses as a JSON array with at least one entry', () => {
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
  });

  test('every entry has a file field matching the D1 migration naming convention', () => {
    for (const entry of ledger) {
      expect(typeof entry.file).toBe('string');
      expect(entry.file).toMatch(MIGRATION_FILE_PATTERN);
    }
  });

  test('every entry has an appliedAt field that is a valid UTC ISO 8601 timestamp', () => {
    for (const entry of ledger) {
      expect(typeof entry.appliedAt).toBe('string');
      expect(entry.appliedAt).toMatch(ISO_8601_UTC_PATTERN);
      const timestamp = Date.parse(entry.appliedAt);
      expect(Number.isNaN(timestamp)).toBe(false);
    }
  });

  test('file names are unique across the ledger', () => {
    const fileNames = ledger.map((entry) => entry.file);
    expect(new Set(fileNames).size).toBe(fileNames.length);
  });

  test('ledger entries are ordered by appliedAt (append-only, no out-of-order backfill)', () => {
    const timestamps = ledger.map((entry) => Date.parse(entry.appliedAt));
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
  });

  describe('b3-device-keys migration entry (handoff prerequisite)', () => {
    const EXPECTED_FILE = '2026-08-26-b3-device-keys.sql';

    let entry: StagingMigrationEntry | undefined;

    beforeAll(() => {
      entry = ledger.find((candidate) => candidate.file === EXPECTED_FILE);
    });

    test('exists in the ledger (handoff gate prerequisite)', () => {
      expect(entry).toBeDefined();
    });

    test('uses the exact migration file name with the date prefix', () => {
      expect(entry?.file).toBe(EXPECTED_FILE);
    });

    test('appliedAt is a valid UTC timestamp', () => {
      expect(entry?.appliedAt).toMatch(ISO_8601_UTC_PATTERN);
      expect(Number.isNaN(Date.parse(entry?.appliedAt ?? ''))).toBe(false);
    });

    test('appliedAt is not before the migration file date prefix', () => {
      // The file prefix encodes the migration authoring date (2026-08-26);
      // applying a migration before it was authored is impossible.
      const fileDate = Date.parse('2026-08-26T00:00:00Z');
      const appliedAt = Date.parse(entry?.appliedAt ?? '');
      expect(appliedAt).toBeGreaterThanOrEqual(fileDate);
    });

    test('appliedAt is not in the future', () => {
      const appliedAt = Date.parse(entry?.appliedAt ?? '');
      expect(appliedAt).toBeLessThanOrEqual(Date.now());
    });
  });
});