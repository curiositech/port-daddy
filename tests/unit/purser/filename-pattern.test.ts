// tests/unit/purser/filename-pattern.test.ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const appliedPath = path.join(
  __dirname,
  '..',
  '..',
  'apps',
  'relay',
  'migrations',
  'applied-staging.json',
);

const fileNameRegex = /^2026-08-(0[4-9]|1[0-2]|22)-[a-z0-9-]+\.sql$/;
const appliedAtTimestamp = '2026-08-22T17:39:02Z';

describe('applied-staging.json migration entries', () => {
  let migrations: { file: string; appliedAt: string }[];

  beforeAll(async () => {
    const raw = await readFile(appliedPath, 'utf8');
    const data = JSON.parse(raw);
    migrations = data.migrations;
  });

  test('all migration filenames match the required pattern', () => {
    migrations.forEach((m) => {
      expect(m.file).toMatch(fileNameRegex);
    });
  });

  test('all new migration entries have the exact appliedAt timestamp', () => {
    migrations.forEach((m) => {
      // The contract requires the timestamp to be exactly the ISO string shown
      expect(m.appliedAt).toBe(appliedAtTimestamp);
    });
  });

  test('contains exactly six new migration entries', () => {
    // The first entry (2026-08-04-x4-parleys.sql) existed before
    // All other entries are new; count them
    const newEntries = migrations.filter(
      (m) => m.appliedAt === appliedAtTimestamp,
    );
    expect(newEntries.length).toBe(6);
  });
});