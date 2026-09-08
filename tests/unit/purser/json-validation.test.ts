// tests/unit/purser/json-validation.test.ts
import fs from 'fs';

const appliedPath = new URL(
  '../../../apps/relay/migrations/applied-staging.json',
  import.meta.url,
).pathname;

const appliedContent = fs.readFileSync(appliedPath, 'utf8');
const ledger = JSON.parse(appliedContent) as {
  applied: { file: string; appliedAt: string; note?: string }[];
};
const applied = ledger.applied;

describe('applied-staging.json structure', () => {
  test('contains the canonical applied array', () => {
    expect(ledger).toHaveProperty('applied');
    expect(Array.isArray(applied)).toBe(true);
  });

  test('retains the 13 migrations present when the contract was written', () => {
    expect(applied.length).toBeGreaterThanOrEqual(13);
  });

  test('each migration has file and appliedAt strings', () => {
    applied.forEach((m) => {
      expect(m).toHaveProperty('file');
      expect(typeof m.file).toBe('string');
      expect(m).toHaveProperty('appliedAt');
      expect(typeof m.appliedAt).toBe('string');
    });
  });

  test('no duplicate migration files', () => {
    const files = applied.map((m) => m.file);
    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });

  test('new migrations have correct timestamp', () => {
    const newFiles = [
      '2026-08-08-relay-baseline.sql',
      '2026-08-09-executor-identity.sql',
      '2026-08-09-mediator-body.sql',
      '2026-08-09-y1-directory-whois.sql',
      '2026-08-09-z-mercy-hooks.sql',
      '2026-08-22-fleet-run-intents.sql',
    ];
    const newTimestamp = '2026-08-22T17:39:02Z';
    newFiles.forEach((file) => {
      const entry = applied.find((m) => m.file === file);
      expect(entry).toBeDefined();
      expect(entry!.appliedAt).toBe(newTimestamp);
    });
  });

  test('file names match expected pattern and date range', () => {
    const fileRegex = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/i;
    applied.forEach((m) => {
      expect(m.file).toMatch(fileRegex);
      const datePart = m.file.slice(0, 10); // YYYY-MM-DD
      const date = new Date(datePart);
      expect(date.toISOString().slice(0, 10)).toBe(datePart);
    });
  });

  test('appliedAt timestamps are ISO 8601 Z format', () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    applied.forEach((m) => {
      expect(m.appliedAt).toMatch(isoRegex);
    });
  });

  test('migration entries contain only canonical keys', () => {
    applied.forEach((m) => {
      const keys = Object.keys(m);
      expect(keys).toContain('file');
      expect(keys).toContain('appliedAt');
      expect(keys.every((key) => ['file', 'appliedAt', 'note'].includes(key))).toBe(true);
      if (m.note !== undefined) expect(typeof m.note).toBe('string');
    });
  });

  test('existing migrations have distinct appliedAt values', () => {
    const timestamps = applied.map((m) => m.appliedAt);
    const uniqueTimestamps = new Set(timestamps);
    // Expect at least two distinct timestamps: old ones and the new uniform one
    expect(uniqueTimestamps.size).toBeGreaterThan(1);
  });
});
