// tests/unit/purser/invalid-runner.test.js
import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const routingPath = join(repoRoot, 'tests', 'purser', 'ROUTING.json');
const routing = JSON.parse(readFileSync(routingPath, 'utf8'));

const ALLOWED_RUNNERS = new Set(['node-test', 'jest', 'quarantined', 'helper']);

describe('ROUTING.json runner validation', () => {
  test('runners section lists exactly the allowed runner keys', () => {
    const actualKeys = new Set(Object.keys(routing.runners ?? {}));
    expect(actualKeys).toEqual(ALLOWED_RUNNERS);
  });

  test('all runner values are non-empty strings', () => {
    for (const [key, value] of Object.entries(routing.runners ?? {})) {
      expect(typeof value).toBe('string');
      expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  test('every file entry has a runner property that is a string', () => {
    for (const [file, entry] of Object.entries(routing.files ?? {})) {
      const runner = entry.runner;
      expect(runner).toBeDefined();
      expect(typeof runner).toBe('string');
    }
  });

  test('no file entry uses an unknown runner', () => {
    const unknown = Object.entries(routing.files ?? {})
      .filter(([, entry]) => !ALLOWED_RUNNERS.has(entry.runner))
      .map(([file, entry]) => `${file} -> ${entry.runner}`);
    expect(unknown).toEqual([]);
  });

  test('no extra runner keys beyond the allowed set', () => {
    const extra = Object.keys(routing.runners ?? {})
      .filter((k) => !ALLOWED_RUNNERS.has(k));
    expect(extra).toEqual([]);
  });

  test('quarantined entries must include a non-empty reason', () => {
    const quarantined = Object.entries(routing.files ?? {})
      .filter(([, entry]) => entry.runner === 'quarantined');
    for (const [file, entry] of quarantined) {
      const reason = entry.reason ?? '';
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });

  test('no file entry has a runner property that is null or undefined', () => {
    const bad = Object.entries(routing.files ?? {})
      .filter(([, entry]) => entry.runner == null);
    expect(bad).toEqual([]);
  });

  test('no file entry has a runner property that is not a string', () => {
    const bad = Object.entries(routing.files ?? {})
      .filter(([, entry]) => typeof entry.runner !== 'string');
    expect(bad).toEqual([]);
  });
});
