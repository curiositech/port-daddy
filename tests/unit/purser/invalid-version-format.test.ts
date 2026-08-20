// tests/unit/purser/invalid-version-format.test.ts
import syncVersion from '../../../scripts/sync-version';

describe('sync-version', () => {
  const invalidVersions = ['v3.29.0', '3.29', '3.29.0.0', '3.29.0-beta', '01.02.03'];

  test('rejects non‑semver version strings', () => {
    for (const ver of invalidVersions) {
      expect(() => syncVersion(ver)).toThrow();
    }
  });
});