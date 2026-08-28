// tests/unit/purser/artifact-tamper-detection.test.ts

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

type CargoPackage = { name: string; version: string };

/**
 * Very small TOML extractor – sufficient for our Cargo.toml which
 * contains `name = "…"` and `version = "…"`. Falls back to null if not found.
 */
function parseCargoToml(content: string): CargoPackage | null {
  const nameMatch = /name\s*=\s*"([^"]+)"/m.exec(content);
  const versionMatch = /version\s*=\s*"([^"]+)"/m.exec(content);
  if (nameMatch && versionMatch) {
    return { name: nameMatch[1], version: versionMatch[1] };
  }
  return null;
}

/**
 * Parses Cargo.lock (which is TOML‑like) and returns all `[[package]]` entries.
 */
function parseCargoLock(content: string): CargoPackage[] {
  const packages: CargoPackage[] = [];
  const lines = content.split(/\r?\n/);
  let current: Partial<CargoPackage> | null = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (line === '[[package]]') {
      if (current?.name && current?.version) {
        packages.push({ name: current.name, version: current.version });
      }
      current = {};
      continue;
    }

    if (!current) continue;

    const nameMatch = /^name\s*=\s*"([^"]+)"$/.exec(line);
    if (nameMatch) {
      current.name = nameMatch[1];
      continue;
    }

    const versionMatch = /^version\s*=\s*"([^"]+)"$/.exec(line);
    if (versionMatch) {
      current.version = versionMatch[1];
    }
  }

  // push the last package if the file didn't end with a new [[package]]
  if (current?.name && current?.version) {
    packages.push({ name: current.name, version: current.version });
  }

  return packages;
}

/**
 * Helper to resolve a file path relative to this test file, handling ESM __dirname.
 */
function resolveRepoPath(relativePath: string): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, relativePath);
}

describe('Cargo artifact tamper detection', () => {
  test('Cargo.toml version matches Cargo.lock and the repository VERSION file', async () => {
    // Resolve paths
    const cargoTomlPath = resolveRepoPath('../../core/pd-console/Cargo.toml');
    const cargoLockPath = resolveRepoPath('../../Cargo.lock');
    const versionFilePath = resolveRepoPath('../../VERSION');

    // Load files
    const [tomlRaw, lockRaw, versionRaw] = await Promise.all([
      readFile(cargoTomlPath, 'utf8'),
      readFile(cargoLockPath, 'utf8'),
      readFile(versionFilePath, 'utf8').catch(() => ''), // VERSION may be missing; treat as empty
    ]);

    // Parse Cargo.toml
    const tomlPkg = parseCargoToml(tomlRaw);
    expect(tomlPkg).not.toBeNull();
    if (!tomlPkg) return; // safety for TypeScript

    // Parse Cargo.lock
    const lockPkgs = parseCargoLock(lockRaw);
    const lockPkg = lockPkgs.find(p => p.name === tomlPkg.name);
    expect(lockPkg).toBeDefined();

    // Verify version consistency between Cargo.toml and Cargo.lock
    expect(lockPkg?.version).toBe(
      tomlPkg.version,
      `Version mismatch for package "${tomlPkg.name}": Cargo.toml reports "${tomlPkg.version}" but Cargo.lock reports "${lockPkg?.version}"`
    );

    // Verify the repository VERSION file (if present) matches Cargo.toml version
    const versionFileTrimmed = versionRaw.trim();
    if (versionFileTrimmed) {
      expect(versionFileTrimmed).toBe(
        tomlPkg.version,
        `VERSION file ("${versionFileTrimmed}") does not match Cargo.toml version ("${tomlPkg.version}")`
      );
    }

    // Finally, assert that the version adheres to the expected release version (3.30.5)
    const expectedVersion = '3.30.5';
    expect(tomlPkg.version).toBe(
      expectedVersion,
      `Cargo.toml version "${tomlPkg.version}" does not match the expected release version "${expectedVersion}"`
    );
  });
});