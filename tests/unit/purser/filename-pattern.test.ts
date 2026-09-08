// tests/unit/purser/filename-pattern.test.ts
import { readFile } from 'node:fs/promises';

const appliedPath = new URL(
  '../../../apps/relay/migrations/applied-staging.json',
  import.meta.url,
);

const fileNameRegex = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/;
const appliedAtTimestamp = '2026-08-22T17:39:02Z';
const expectedFiles = [
  '2026-08-08-relay-baseline.sql',
  '2026-08-09-executor-identity.sql',
  '2026-08-09-mediator-body.sql',
  '2026-08-09-y1-directory-whois.sql',
  '2026-08-09-z-mercy-hooks.sql',
  '2026-08-22-fleet-run-intents.sql',
] as const;

describe('applied-staging.json migration entries', () => {
  let migrations: { file: string; appliedAt: string }[];

  beforeAll(async () => {
    const raw = await readFile(appliedPath, 'utf8');
    const data = JSON.parse(raw) as {
      applied: { file: string; appliedAt: string }[];
    };
    migrations = data.applied;
  });

  test('all migration filenames match the required pattern', () => {
    migrations.forEach((m) => {
      expect(m.file).toMatch(fileNameRegex);
    });
  });

  test('all new migration entries have the exact appliedAt timestamp', () => {
    expectedFiles.forEach((file) => {
      const entry = migrations.find((migration) => migration.file === file);
      expect(entry).toBeDefined();
      expect(entry?.appliedAt).toBe(appliedAtTimestamp);
    });
  });

  test('contains exactly six new migration entries', () => {
    const expectedFileSet = new Set(expectedFiles);
    const contractEntries = migrations.filter((migration) =>
      expectedFileSet.has(migration.file as (typeof expectedFiles)[number]),
    );
    expect(contractEntries.map((entry) => entry.file).sort()).toEqual(
      [...expectedFiles].sort(),
    );
  });
});
