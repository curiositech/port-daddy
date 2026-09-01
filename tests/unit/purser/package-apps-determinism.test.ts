// tests/unit/purser/package-apps-determinism.test.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively walk a directory and return an array describing each entry.
 * Directories are omitted; only regular files and symlinks are reported.
 */
function walkBundle(
  base: string,
  rel = '',
): Array<{ path: string; type: 'file' | 'symlink'; content?: Buffer; linkTarget?: string }> {
  const entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true });
  const results: Array<{
    path: string;
    type: 'file' | 'symlink';
    content?: Buffer;
    linkTarget?: string;
  }> = [];

  for (const entry of entries) {
    const entryRel = path.join(rel, entry.name);
    const fullPath = path.join(base, entryRel);

    if (entry.isDirectory()) {
      results.push(...walkBundle(base, entryRel));
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(fullPath);
      results.push({ path: entryRel, type: 'symlink', linkTarget: target });
    } else if (entry.isFile()) {
      const content = fs.readFileSync(fullPath);
      results.push({ path: entryRel, type: 'file', content });
    }
    // Other types (FIFO, socket, etc.) are ignored – they should never appear.
  }

  return results;
}

/**
 * Verify that the given .app bundle is signed ad‑hoc.
 * The `codesign -dvvv` output must contain "Authority=adhoc".
 */
function verifyAdHocSigned(appPath: string): void {
  const out = execFileSync('codesign', ['-dvvv', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(out).toMatch(/Authority=adhoc/);
}

/**
 * Compare two bundles (arrays returned by walkBundle) for exact equality.
 */
function expectBundlesEqual(
  a: ReturnType<typeof walkBundle>,
  b: ReturnType<typeof walkBundle>,
): void {
  const sortByPath = (x: { path: string }, y: { path: string }) =>
    x.path.localeCompare(y.path);
  a.sort(sortByPath);
  b.sort(sortByPath);

  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    const af = a[i];
    const bf = b[i];
    expect(af.path).toBe(bf.path);
    expect(af.type).toBe(bf.type);

    if (af.type === 'file') {
      // Buffer.equals is safe because we know both are Buffers
      expect(af.content!.equals(bf.content!)).toBe(true);
    } else if (af.type === 'symlink') {
      expect(af.linkTarget).toBe(bf.linkTarget);
    }
  }
}

// -----------------------------------------------------------------------------
// Test setup
// -----------------------------------------------------------------------------
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../..');
const scriptPath = path.join(
  repoRoot,
  'apps',
  'porthole-stage-capture',
  'Scripts',
  'package-apps.sh',
);

const isSupported =
  process.platform === 'darwin' &&
  commandExists('swift') &&
  commandExists('codesign') &&
  commandExists('rsvg-convert') &&
  commandExists('iconutil') &&
  fs.existsSync(scriptPath);

// -----------------------------------------------------------------------------
// Determinism test
// -----------------------------------------------------------------------------
if (!isSupported) {
  // Skip on unsupported platforms (e.g., CI runners that aren't macOS) or when tooling is missing.
  test.skip('Deterministic packaging test skipped – requires macOS and build tools', () => {});
} else {
  // Allow generous time for the Swift build; the CI job expects up to several minutes.
  jest.setTimeout(5 * 60 * 1000);

  test('package-apps.sh produces byte‑identical ad‑hoc‑signed bundles on successive runs', () => {
    // Create a clean temporary workspace.
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'porthole-determinism-'));
    const outA = path.join(tempRoot, 'run-a');
    const outB = path.join(tempRoot, 'run-b');

    try {
      // First invocation – performs a fresh Swift build.
      execFileSync(
        scriptPath,
        [
          '--configuration',
          'release',
          '--output',
          outA,
          '--signing-identity',
          '-',
          '--allow-ad-hoc',
        ],
        { stdio: 'inherit', cwd: repoRoot },
      );

      // Second invocation – skips the Swift build, re‑packages the existing artifacts.
      execFileSync(
        scriptPath,
        [
          '--skip-build',
          '--configuration',
          'release',
          '--output',
          outB,
          '--signing-identity',
          '-',
          '--allow-ad-hoc',
        ],
        { stdio: 'inherit', cwd: repoRoot },
      );

      const appNames = ['Porthole.app', 'PortholeFixture.app'];

      for (const app of appNames) {
        const aPath = path.join(outA, app);
        const bPath = path.join(outB, app);

        // Both bundles must be present.
        expect(fs.existsSync(aPath)).toBe(true);
        expect(fs.existsSync(bPath)).toBe(true);

        // Verify ad‑hoc signing on each bundle.
        verifyAdHocSigned(aPath);
        verifyAdHocSigned(bPath);

        // Gather file listings and compare byte‑for‑byte.
        const aBundle = walkBundle(aPath);
        const bBundle = walkBundle(bPath);
        expectBundlesEqual(aBundle, bBundle);
      }
    } finally {
      // Clean up the temporary directory regardless of test outcome.
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // Ignored – best‑effort cleanup.
      }
    }
  });
}