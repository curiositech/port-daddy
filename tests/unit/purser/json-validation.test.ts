// tests/unit/purser/json-validation.test.ts
import fs from 'fs';

const appliedPath = new URL(
  '../../../apps/relay/migrations/applied-staging.json',
  import.meta.url,
).pathname;

const appliedContent = fs.readFileSync(appliedPath, 'utf8');
const applied = JSON.parse(appliedContent);

describe('applied-staging.json structure', () => {
  test('contains a migrations array', () => {
    expect(applied).toHaveProperty('migrations');
    expect(Array.isArray(applied.migrations)).toBe(true);
  });

  test('has exactly 13 migrations', () => {
    expect(applied.migrations.length).toBe(13);
  });

  test('each migration has file and appliedAt strings', () => {
    applied.migrations.forEach((m, idx) => {
      expect(m).toHaveProperty('file');
      expect(typeof m.file).toBe('string');
      expect(m).toHaveProperty('appliedAt');
      expect(typeof m.appliedAt).toBe('string');
    });
  });

  test('no duplicate migration files', () => {
    const files = applied.migrations.map((m) => m.file);
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
      const entry = applied.migrations.find((m) => m.file === file);
      expect(entry).toBeDefined();
      expect(entry!.appliedAt).toBe(newTimestamp);
    });
  });

  test('file names match expected pattern and date range', () => {
    const fileRegex = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/i;
    applied.migrations.forEach((m) => {
      expect(m.file).toMatch(fileRegex);
      const datePart = m.file.slice(0, 10); // YYYY-MM-DD
      const date = new Date(datePart);
      expect(date.toISOString().slice(0, 10)).toBe(datePart);
      const minDate = new Date('2026-08-04');
      const maxDate = new Date('2026-08-22');
      expect(date >= minDate && date <= maxDate).toBe(true);
    });
  });

  test('appliedAt timestamps are ISO 8601 Z format', () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    applied.migrations.forEach((m) => {
      expect(m.appliedAt).toMatch(isoRegex);
    });
  });

  test('migration entries contain only file and appliedAt keys', () => {
    applied.migrations.forEach((m) => {
      const keys = Object.keys(m);
      expect(keys.length).toBe(2);
      expect(keys).toContain('file');
      expect(keys).toContain('appliedAt');
    });
  });

  test('existing migrations have distinct appliedAt values', () => {
    const timestamps = applied.migrations.map((m) => m.appliedAt);
    const uniqueTimestamps = new Set(timestamps);
    // Expect at least two distinct timestamps: old ones and the new uniform one
    expect(uniqueTimestamps.size).toBeGreaterThan(1);
  });
});