// tests/unit/purser/quarantined-no-reason.test.js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const routingPath = join(repoRoot, 'tests', 'purser', 'ROUTING.json');
const routing = JSON.parse(readFileSync(routingPath, 'utf8'));

describe('quarantined entries must have a specific, non‑empty reason', () => {
  test('every quarantined file has a reason string that is not empty', () => {
    const quarantined = Object.entries(routing.files)
      .filter(([, entry]) => entry.runner === 'quarantined');

    // There must be at least one quarantined entry; otherwise the test would
    // silently pass even if the rule is missing.
    expect(quarantined.length).toBeGreaterThan(0);

    const failures = quarantined
      .filter(([, entry]) => {
        const r = entry.reason;
        return typeof r !== 'string' || r.trim().length === 0;
      })
      .map(([file]) => file);

    expect(failures).toEqual([]);
  });

  test('reason strings are not generic placeholders', () => {
    const quarantined = Object.entries(routing.files)
      .filter(([, entry]) => entry.runner === 'quarantined');

    const generic = quarantined
      .filter(([, entry]) => {
        const r = entry.reason?.trim().toLowerCase();
        // common placeholder values that lack specificity
        return r === 'none' || r === 'unknown' || r === 'not executed' || r === 'broken';
      })
      .map(([file]) => file);

    expect(generic).toEqual([]);
  });
});