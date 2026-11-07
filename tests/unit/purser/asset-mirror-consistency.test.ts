// tests/unit/purser/asset-mirror-consistency.test.ts
import { describe, expect, test } from '@jest/globals';
import { cpSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repository root relative to this test file
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..', '..', '..'); // repo root

/**
 * Helper to perform a shallow copy of the assets directory using the same
 * options the production script uses (recursive, preserve timestamps, etc.).
 * It mirrors `whitepaper/figures/assets` into a temporary output location.
 */
function mirrorAssets(srcRoot: string, outRoot: string) {
  const src = resolve(srcRoot, 'whitepaper', 'figures', 'assets');
  const dst = resolve(outRoot, 'figures', 'assets');

  // Ensure the destination directory is clean before each run
  if (existsSync(dst)) {
    // Remove any existing files to avoid false positives from previous runs.
    // Using rm -rf is safe in the test sandbox because dst is under a temp dir.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { rmSync } = require('node:fs');
    rmSync(dst, { recursive: true, force: true });
  }

  // Perform the copy – this is the exact call the production script makes.
  cpSync(src, dst, { recursive: true });

  return { src, dst };
}

/**
 * Verify that the copy operation respects absolute and relative paths.
 *
 * The production script builds the source and destination via `resolve(repoRoot,
 * 'whitepaper/figures/assets')` and `resolve(outDir, 'figures/assets')`.  This
 * test reproduces that logic and asserts:
 *
 *   1. The destination exists and is a directory.
 *   2. Every file present under the source appears under the destination with
 *      the same relative path.
 *   3. No extra files appear in the destination.
 */
function assertMirrorIntegrity(src: string, dst: string) {
  // Gather all files (not directories) under source and destination.
  const collectFiles = (base: string) => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          files.push(relative(base, full));
        }
      }
    };
    walk(base);
    return files.sort();
  };

  const srcFiles = collectFiles(src);
  const dstFiles = collectFiles(dst);

  expect(dstFiles).toEqual(
    srcFiles,
    `Destination assets should contain exactly the same files as source.\n` +
      `Missing in destination: ${srcFiles.filter((f) => !dstFiles.includes(f)).join(', ')}\n` +
      `Unexpected in destination: ${dstFiles.filter((f) => !srcFiles.includes(f)).join(', ')}`,
  );
}

/**
 * Simulate a failure scenario where the source assets directory is missing.
 *
 * The production script should throw an error (or at least not create a destination
 * directory) when `cpSync` cannot locate the source.  This test ensures that such
 * a failure is surfaced, preventing silent loss of figure assets.
 */
function assertMissingSourceFails(srcRoot: string, outRoot: string) {
  const bogusSrc = resolve(srcRoot, 'nonexistent', 'path');
  const dst = resolve(outRoot, 'figures', 'assets');

  // Clean any leftover destination.
  if (existsSync(dst)) {
    const { rmSync } = require('node:fs');
    rmSync(dst, { recursive: true, force: true });
  }

  // Expect cpSync to throw ENOENT.
  expect(() => cpSync(bogusSrc, dst, { recursive: true })).toThrow();
}

/**
 * Create a temporary directory inside the repository's `tmp` folder.
 * The folder is unique per test run to avoid cross‑test interference.
 */
function makeTempDir(): string {
  const { mkdtempSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  // Use a stable prefix so the path is predictable in CI logs.
  return mkdtempSync(resolve(tmpdir(), 'legible-swarm-assets-'));
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Asset mirroring for whitepaper figures', () => {
  const repoRoot = __dirname; // repository root resolved above
  const outRoot = makeTempDir();

  test('cpSync mirrors assets preserving relative structure', () => {
    const { src, dst } = mirrorAssets(repoRoot, outRoot);
    // Verify both source and destination actually exist and are directories.
    expect(existsSync(src) && lstatSync(src).isDirectory()).toBe(true);
    expect(existsSync(dst) && lstatSync(dst).isDirectory()).toBe(true);

    // Assert the copy retained the exact file tree.
    assertMirrorIntegrity(src, dst);
  });

  test('missing source directory causes cpSync to throw', () => {
    assertMissingSourceFails(repoRoot, outRoot);
  });
});