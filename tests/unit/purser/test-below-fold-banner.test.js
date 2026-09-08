// tests/unit/purser/test-below-fold-banner.test.js
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('doc-retirement-guard: banner below the fold', () => {
  it('fails when a RETIRED-BY banner is after the first 40 lines', () => {
    // Resolve paths to the guard script and the fixture
    const scriptPath = resolve(__dirname, '../../../scripts/doc-retirement-guard.mjs');
    const fixtureRoot = resolve(__dirname, '../../../tests/fixtures/doc-retirement/below-fold');
    const manifestPath = resolve(fixtureRoot, 'manifest.json');

    // Run the guard against the fixture
    const result = spawnSync('node', [
      scriptPath,
      '--root',
      fixtureRoot,
      '--manifest',
      manifestPath,
    ], {
      encoding: 'utf8',
    });

    // The guard should exit with a non‑zero status
    expect(result.status).not.toBe(0);

    // The output should mention that the banner is below line 40
    expect(result.stdout).toContain('below line 40');
    expect(result.stdout).toContain(
      'RETIRED-BY marker found, but below line 40'
    );
  });
});