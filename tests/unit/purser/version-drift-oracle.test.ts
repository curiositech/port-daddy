// tests/unit/purser/version-drift-oracle.test.ts
/**
 * Version‑drift oracle – ensures every declared version in the repository matches the
 * canonical VERSION file (which should be bumped to 3.30.5 for this release).
 *
 * The contract for PR #9942 requires that *all* version sources – package.json,
 * Cargo.toml files, TypeScript source constants, and the plain‑text VERSION file –
 * stay in lock‑step.  This test reads each source, extracts the version string, and
 * asserts equality with the canonical version.
 *
 * If any source drifts, the CI will fail, preventing the release from being tagged.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repository root from this test file (tests/unit/purser → repository root)
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

// Helper: read the canonical version from the VERSION file
function getCanonicalVersion(): string {
  const versionPath = join(REPO_ROOT, 'VERSION');
  return readFileSync(versionPath, 'utf8').trim();
}

// Helper: extract `version` field from a package.json
function getVersionFromPackageJson(relPath: string): string {
  const pkgPath = join(REPO_ROOT, relPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (!pkg.version) {
    throw new Error(`No "version" field in ${relPath}`);
  }
  return pkg.version.trim();
}

// Helper: extract the first `version = "x.y.z"` line from a Cargo.toml
function getVersionFromCargoToml(relPath: string): string {
  const tomlPath = join(REPO_ROOT, relPath);
  const content = readFileSync(tomlPath, 'utf8');
  const match = content.match(/version\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error(`Unable to locate version in ${relPath}`);
  }
  return match[1].trim();
}

// Helper: extract a version string literal from a TypeScript source file.
// Looks for patterns like: const VERSION = "3.30.5";  or export const version = '3.30.5';
function getVersionFromTsFile(relPath: string): string {
  const tsPath = join(REPO_ROOT, relPath);
  const content = readFileSync(tsPath, 'utf8');
  const match = content.match(/['"](\d+\.\d+\.\d+(?:\.\d+)?)['"]/);
  if (!match) {
    throw new Error(`No version literal found in ${relPath}`);
  }
  return match[1].trim();
}

// Helper: extract version from a generic JSON file (e.g., manifest.json) that
// contains a top‑level `version` property.
function getVersionFromJson(relPath: string): string {
  const jsonPath = join(REPO_ROOT, relPath);
  const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (!data.version) {
    throw new Error(`No "version" property in ${relPath}`);
  }
  return String(data.version).trim();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Version drift oracle', () => {
  const canonical = getCanonicalVersion();

  test('canonical VERSION file contains the expected release version', () => {
    // The contract explicitly expects 3.30.5 for this PR.
    expect(canonical).toBe('3.30.5');
  });

  const checks: Array<{ name: string; getVersion: () => string }> = [
    {
      name: 'package.json',
      getVersion: () => getVersionFromPackageJson('package.json'),
    },
    {
      name: 'core/pd-console/Cargo.toml',
      getVersion: () => getVersionFromCargoToml('core/pd-console/Cargo.toml'),
    },
    {
      name: 'cli/commands/diagnostics.ts',
      getVersion: () => getVersionFromTsFile('cli/commands/diagnostics.ts'),
    },
    {
      name: 'server.ts',
      getVersion: () => getVersionFromTsFile('server.ts'),
    },
    {
      name: 'public/samples/manifest.json',
      getVersion: () => getVersionFromJson('public/samples/manifest.json'),
    },
  ];

  for (const { name, getVersion } of checks) {
    test(`version in ${name} matches VERSION file`, () => {
      const found = getVersion();
      expect(found).toBe(canonical);
    });
  }
});