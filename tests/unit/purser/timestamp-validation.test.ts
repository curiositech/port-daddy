// tests/unit/purser/timestamp-validation.test.ts
import fs from 'node:fs';
import path from 'node:path';

describe('applied-staging.json timestamp validation', () => {
  const expectedTimestamp = '2026-08-22T17:39:02Z';
  const expectedFiles = [
    '2026-08-08-relay-baseline.sql',
    '2026-08-09-executor-identity.sql',
    '2026-08-09-mediator-body.sql',
    '2026-08-09-y1-directory-whois.sql',
    '2026-08-09-z-mercy-hooks.sql',
    '2026-08-22-fleet-run-intents.sql',
  ];

  const filePath = path.resolve(process.cwd(), 'apps/relay/migrations/applied-staging.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const ledger = JSON.parse(raw) as {
    applied: Array<{ file: string; appliedAt: string }>;
  };
  const data = ledger.applied;

  test('all new migrations have the correct appliedAt timestamp', () => {
    const entriesWithTimestamp = data.filter(e => e.appliedAt === expectedTimestamp);
    expect(entriesWithTimestamp.length).toBe(expectedFiles.length);

    expectedFiles.forEach(file => {
      const entry = entriesWithTimestamp.find(e => e.file === file);
      expect(entry).toBeDefined();
      expect(entry?.appliedAt).toBe(expectedTimestamp);
    });

    // Ensure no unexpected entries share the timestamp
    const unexpected = entriesWithTimestamp.filter(e => !expectedFiles.includes(e.file));
    expect(unexpected).toHaveLength(0);
  });

  test('appliedAt timestamps match ISO 8601 format', () => {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
    data.forEach(entry => {
      expect(entry.appliedAt).toMatch(isoRegex);
    });
  });
});
