// tests/unit/purser/test-broken-banner-links.test.js
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

describe('doc-retirement-guard: broken banner links', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'doc-retire-'));

  // Helper to run the guard with custom root/manifest
  const runGuard = () => {
    const cmd = resolve(tempRoot, 'scripts', 'doc-retirement-guard.mjs');
    return spawnSync('node', [cmd, '--root', tempRoot, '--manifest', join(tempRoot, 'docs', 'retirement-manifest.json')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  };

  beforeAll(() => {
    // Create minimal ADR file so liveAdrNumbers is populated
    const adrDir = join(tempRoot, 'docs', 'adr');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, '0126-shared-harbors-resequencing.md'), '# ADR-0126');

    // Create the retired document with a broken banner link
    const docDir = join(tempRoot, 'docs');
    mkdirSync(docDir, { recursive: true });
    writeFileSync(
      join(docDir, 'retired-doc.md'),
      `<!-- RETIRED-BY: ADR-0126 -->\n\n# Retired Document\n\n[Non-existent](docs/nonexistent.md)\n`
    );

    // Create retirement manifest pointing to the retired doc
    const manifest = {
      retired: {
        'docs/retired-doc.md': {
          supersededBy: 'ADR-0126',
          reason: 'Example retirement',
          replacedBy: [],
        },
      },
    };
    writeFileSync(join(docDir, 'retirement-manifest.json'), JSON.stringify(manifest));
  });

  afterAll(() => {
    // Clean up temp directory
    const rimraf = (path) => {
      if (!existsSync(path)) return;
      const stat = require('node:fs').statSync(path);
      if (stat.isDirectory()) {
        for (const f of require('node:fs').readdirSync(path)) {
          rimraf(join(path, f));
        }
        require('node:fs').rmdirSync(path);
      } else {
        require('node:fs').unlinkSync(path);
      }
    };
    rimraf(tempRoot);
  });

  test('fails when a banner link does not resolve from the file directory', () => {
    const result = runGuard();
    // Guard should exit with code 1 for the broken link
    expect(result.status).toBe(1);
    // Output should mention the broken link target
    expect(result.stdout).toMatch(/banner links to "docs\/nonexistent\.md"/);
    // Ensure the error message is printed to stdout (not stderr)
    expect(result.stderr).toBe('');
  });
});