/**
 * tests/unit/purser/release-pipeline-gate-mutation.test.ts
 *
 * This test suite enforces the strict release‑pipeline contract for the
 * “chore(release): bump to 3.30.5” PR.  It validates that every version surface
 * in the repository is consistent with the single source of truth (`VERSION`),
 * that CI configuration contains the required gating steps, that the release
 * workflow references the soak/batten/formula‑compat checks, and that the
 * helper scripts (`sync-version.ts`, diagnostics, server) embed the same
 * version string.
 *
 * The suite is deliberately exhaustive – any deviation (missing file,
 * mismatched version, absent CI step) causes a test failure, preventing the
 * release pipeline from proceeding.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repository root from this test file (tests/unit/purser/…)
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Recursively walk a directory tree and return absolute paths of all files
 * whose name matches the supplied regular expression.
 */
function findFiles(
  dir: string,
  matcher: RegExp,
  acc: string[] = []
): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      findFiles(full, matcher, acc);
    } else if (matcher.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Load a file as UTF‑8 text, throwing a clear error if it does not exist.
 */
function loadFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`Required file not found: ${path}`);
  }
  return readFileSync(path, 'utf8');
}

/**
 * Assert that a given file's contents contain the expected version string.
 */
function expectVersionInFile(filePath: string, expected: string): void {
  const content = loadFile(filePath);
  expect(content).toContain(expected);
}

/**
 * Extract the `version = "X.Y.Z"` line from a Cargo.toml file.
 */
function extractCargoVersion(toml: string): string | null {
  const match = toml.match(/^version\s*=\s*["']([^"']+)["']/m);
  return match ? match[1] : null;
}

/**
 * Load and parse the repository's single source of truth for the version.
 */
function getExpectedVersion(): string {
  const versionFile = join(REPO_ROOT, 'VERSION');
  return loadFile(versionFile).trim();
}

// -----------------------------------------------------------------------------
// Test Suites
// -----------------------------------------------------------------------------

describe('Release pipeline version consistency', () => {
  const EXPECTED_VERSION = getExpectedVersion();

  test('VERSION file exists and is non‑empty', () => {
    const versionPath = join(REPO_ROOT, 'VERSION');
    expect(existsSync(versionPath)).toBe(true);
    const raw = loadFile(versionPath).trim();
    expect(raw).toMatch(/^\d+\.\d+\.\d+$/);
    expect(raw).toBe(EXPECTED_VERSION);
  });

  test('package.json version matches VERSION', () => {
    const pkgPath = join(REPO_ROOT, 'package.json');
    const pkg = JSON.parse(loadFile(pkgPath));
    expect(pkg.version).toBe(EXPECTED_VERSION);
  });

  test('Cargo.toml version matches VERSION', () => {
    const cargoPath = join(REPO_ROOT, 'core', 'pd-console', 'Cargo.toml');
    const cargo = loadFile(cargoPath);
    const cargoVersion = extractCargoVersion(cargo);
    expect(cargoVersion).not.toBeNull();
    expect(cargoVersion).toBe(EXPECTED_VERSION);
  });

  test('All source files that embed the version stay in sync', () => {
    // Files that are expected to contain the version literal
    const versionedFiles = [
      join(REPO_ROOT, 'cli', 'commands', 'diagnostics.ts'),
      join(REPO_ROOT, 'server.ts'),
      join(REPO_ROOT, 'mcp', 'server.ts'),
    ];

    for (const file of versionedFiles) {
      expectVersionInFile(file, EXPECTED_VERSION);
    }
  });
});

describe('CI configuration guards', () => {
  const workflowsDir = join(REPO_ROOT, '.github', 'workflows');

  test('distribution-freshness and version-drift workflow files exist', () => {
    const freshness = join(workflowsDir, 'distribution-freshness.yml');
    const drift = join(workflowsDir, 'version-drift.yml');

    expect(existsSync(freshness)).toBe(true);
    expect(existsSync(drift)).toBe(true);
  });

  test('CI workflows reference the expected version', () => {
    const files = findFiles(workflowsDir, /\.yml$/);
    for (const file of files) {
      const content = loadFile(file);
      // The guard should at least mention the version variable or literal
      expect(content).toMatch(/VERSION|version:\s*["']\d+\.\d+\.\d+["']/);
    }
  });
});

describe('Release workflow integrity', () => {
  const releasePath = join(REPO_ROOT, '.github', 'workflows', 'release.yml');

  test('release.yml exists', () => {
    expect(existsSync(releasePath)).toBe(true);
  });

  test('release.yml contains soak, batten, and formula‑compat steps', () => {
    const content = loadFile(releasePath).toLowerCase();
    expect(content).toContain('soak');
    expect(content).toContain('batten');
    expect(content).toContain('formula-compat');
  });
});

describe('Fresh‑install smoke‑test hooks', () => {
  const pkgPath = join(REPO_ROOT, 'package.json');

  test('package.json defines a fresh‑install script', () => {
    const pkg = JSON.parse(loadFile(pkgPath));
    const scripts = pkg.scripts || {};
    const scriptNames = Object.keys(scripts);
    const hasFresh = scriptNames.some((s) => s.toLowerCase().includes('fresh'));
    expect(hasFresh).toBe(true);
  });

  test('fresh‑install script references tarball and brew install paths', () => {
    const pkg = JSON.parse(loadFile(pkgPath));
    const scripts = pkg.scripts || {};
    const freshScript = Object.values(scripts).find((cmd) =>
      (cmd as string).toLowerCase().includes('fresh')
    ) as string | undefined;

    expect(freshScript).toBeDefined();
    if (freshScript) {
      // Very tolerant checks – we only need to see the two key substrings.
      expect(freshScript).toMatch(/\.tgz|\.tar\.gz/);
      expect(freshScript).toMatch(/brew\s+install/);
    }
  });
});

describe('sync-version.ts stamping logic', () => {
  // Locate the helper script (its location may vary)
  const syncFiles = findFiles(REPO_ROOT, /sync-version\.ts$/);
  test('sync-version.ts exists exactly once', () => {
    expect(syncFiles.length).toBe(1);
  });

  test('sync-version.ts reads the VERSION file and propagates it', () => {
    const [syncPath] = syncFiles;
    const content = loadFile(syncPath);
    // Heuristic: the script should read VERSION and then write to package.json / Cargo.toml
    expect(content).toMatch(/VERSION/);
    expect(content).toMatch(/readFileSync/);
    expect(content).toMatch(/writeFileSync/);
    // Ensure the literal version appears (helps catch stale hard‑coding)
    expect(content).toContain(getExpectedVersion());
  });
});