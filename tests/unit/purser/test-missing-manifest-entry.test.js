// tests/unit/purser/test-missing-manifest-entry.test.js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('doc-retirement-guard: missing manifest entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'doc-retirement-guard-test-'));
  const docsDir = join(root, 'docs');
  const adrDir = join(docsDir, 'adr');
  const retiredFile = join(docsDir, 'retired.md');
  const adrFile = join(adrDir, '0126-sample.md');
  const manifestFile = join(root, 'docs', 'retirement-manifest.json');

  // Setup a minimal environment
  beforeAll(() => {
    // create directories
    [docsDir, adrDir].forEach((d) => {
      if (!existsSync(d)) {
        mkdirSync(d, { recursive: true });
      }
    });

    // create a dummy ADR file so the guard doesn't complain about missing ADR
    writeFileSync(adrFile, '# ADR-0126\nStatus: Accepted', 'utf8');

    // create a retired document with a banner
    writeFileSync(
      retiredFile,
      '<!-- RETIRED-BY: ADR-0126 -->\n\n# Retired document\n',
      'utf8',
    );

    // create an empty manifest (no entries)
    writeFileSync(
      manifestFile,
      JSON.stringify({ retired: {} }, null, 2),
      'utf8',
    );
  });

  afterAll(() => {
    // Clean up the temporary directory
    rmSync(root, { recursive: true, force: true });
  });

  test('fails when a retired file is not listed in the manifest', () => {
    // Resolve path to the guard script relative to this test file
    const guardPath = resolve(
      __dirname,
      '../../../scripts/doc-retirement-guard.mjs',
    );

    const result = spawnSync(
      'node',
      [guardPath, '--root', root, '--manifest', manifestFile],
      { encoding: 'utf8' },
    );

    // Guard should exit with code 1
    expect(result.status).toBe(1);

    // The error message should mention the missing manifest entry
    const stdout = result.stdout ?? '';
    expect(stdout).toMatch(/carries a RETIRED-BY: ADR-0126 banner but is NOT in/);
  });
});