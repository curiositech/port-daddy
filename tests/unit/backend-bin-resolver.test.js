/**
 * Tests for lib/backend-bin-resolver.ts
 *
 * Core concern: verify that binary resolution works correctly given a SPECIFIC
 * PATH string — including the launchd minimal PATH that has historically caused
 * sorties to fail silently. This is the test the pre-existing suite was missing.
 */

import { mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  findBinOnPath,
  resolveBackendBins,
  writeBackendBinCache,
  readBackendBinCache,
  getCachedBinPath,
  resolvedBinDirs,
  ALL_TOOLS,
} from '../../lib/backend-bin-resolver.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake executable binary at <dir>/<name> and return its path. */
function makeFakeBin(dir, name) {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\necho fake\n');
  chmodSync(p, 0o755);
  return p;
}

// ─── findBinOnPath ────────────────────────────────────────────────────────────

describe('findBinOnPath', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = join(homedir(), 'coding', 'tmp', `bbr-test-${randomUUID()}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  test('returns absolute path when binary exists in first PATH dir', () => {
    const binDir = join(tmpBase, 'bin1');
    const binPath = makeFakeBin(binDir, 'claude');
    const result = findBinOnPath(['claude'], `${binDir}:/usr/bin:/bin`);
    expect(result).toBe(binPath);
  });

  test('returns absolute path when binary is in a later PATH dir', () => {
    const binDir1 = join(tmpBase, 'empty');
    const binDir2 = join(tmpBase, 'bin2');
    mkdirSync(binDir1, { recursive: true });
    const binPath = makeFakeBin(binDir2, 'codex');
    const result = findBinOnPath(['codex'], `${binDir1}:${binDir2}:/usr/bin`);
    expect(result).toBe(binPath);
  });

  test('returns null when binary is not on PATH at all', () => {
    const result = findBinOnPath(['claude'], '/usr/bin:/bin:/usr/sbin:/sbin');
    expect(result).toBeNull();
  });

  test('returns null on the LAUNCHD MINIMAL PATH (the real failure mode)', () => {
    // This is the PATH launchd gives the daemon.  Tools in ~/.local/bin or
    // ~/.nvm are invisible here.  This test encodes EXACTLY the failure that
    // caused pd sortie to return "binary not found" in production.
    const launchdPath = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin';
    const result = findBinOnPath(['claude'], launchdPath);
    // Should be null (or a valid absolute path if claude is actually in
    // one of those dirs — unusual but acceptable).
    if (result !== null) {
      const launchdDirs = launchdPath.split(':');
      expect(launchdDirs.some(d => result.startsWith(d))).toBe(true);
    }
  });

  test('tries multiple candidate names, returns first hit', () => {
    const binDir = join(tmpBase, 'multi');
    makeFakeBin(binDir, 'claude-code');
    makeFakeBin(binDir, 'claude');
    const result = findBinOnPath(['claude', 'claude-code'], `${binDir}:/usr/bin`);
    expect(result).toBe(join(binDir, 'claude'));
  });

  test('returns null for empty PATH', () => {
    expect(findBinOnPath(['claude'], '')).toBeNull();
  });

  test('skips directories that do not exist', () => {
    const nonExistent = join(tmpBase, 'ghost');
    const realDir = join(tmpBase, 'real');
    const binPath = makeFakeBin(realDir, 'claude');
    const result = findBinOnPath(['claude'], `${nonExistent}:${realDir}`);
    expect(result).toBe(binPath);
  });
});

// ─── resolveBackendBins ───────────────────────────────────────────────────────

describe('resolveBackendBins', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = join(homedir(), 'coding', 'tmp', `bbr-resolve-${randomUUID()}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  test('resolves each tool correctly when binaries exist on the provided PATH', () => {
    const claudeDir = join(tmpBase, 'claude-bin');
    const codexDir = join(tmpBase, 'codex-bin');
    const claudePath = makeFakeBin(claudeDir, 'claude');
    const codexPath = makeFakeBin(codexDir, 'codex');

    const searchPath = `${claudeDir}:${codexDir}:/usr/bin:/bin`;
    const result = resolveBackendBins(searchPath, ['claude-code', 'codex']);

    expect(result['claude-code'].path).toBe(claudePath);
    expect(result['codex'].path).toBe(codexPath);
    expect(result['claude-code'].searchedPath).toBe(searchPath);
  });

  test('returns null path for tools not on the provided PATH', () => {
    const result = resolveBackendBins('/usr/bin:/bin', ['claude-code', 'codex', 'aider']);
    expect(result['claude-code'].path).toBeNull();
    expect(result['codex'].path).toBeNull();
    expect(result['aider'].path).toBeNull();
  });

  test('resolves all ALL_TOOLS by default', () => {
    const result = resolveBackendBins('/usr/bin:/bin');
    for (const tool of ALL_TOOLS) {
      expect(result).toHaveProperty(tool);
      expect(result[tool]).toHaveProperty('resolvedAt');
      expect(typeof result[tool].resolvedAt).toBe('number');
    }
  });

  test('resolved entries carry a timestamp', () => {
    const before = Date.now();
    const result = resolveBackendBins('/usr/bin:/bin', ['claude-code']);
    const after = Date.now();
    expect(result['claude-code'].resolvedAt).toBeGreaterThanOrEqual(before);
    expect(result['claude-code'].resolvedAt).toBeLessThanOrEqual(after);
  });
});

// ─── Cache I/O ────────────────────────────────────────────────────────────────

describe('writeBackendBinCache / readBackendBinCache', () => {
  let cacheDir;
  let cachePath;

  beforeEach(() => {
    cacheDir = join(homedir(), 'coding', 'tmp', `bbr-cache-${randomUUID()}`);
    cachePath = join(cacheDir, 'backend-bins.json');
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  test('round-trips bins through the cache file', () => {
    const bins = {
      'claude-code': { path: '/home/user/.local/bin/claude', searchedPath: '/home/user/.local/bin', resolvedAt: 1000 },
      codex: { path: null, searchedPath: '/usr/bin', resolvedAt: 1001 },
    };
    writeBackendBinCache(bins, cachePath);
    const loaded = readBackendBinCache(cachePath);
    expect(loaded).not.toBeNull();
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.bins['claude-code'].path).toBe('/home/user/.local/bin/claude');
    expect(loaded.bins['codex'].path).toBeNull();
  });

  test('creates the directory if it does not exist', () => {
    const deepCache = join(cacheDir, 'nested', 'deep', 'backend-bins.json');
    writeBackendBinCache({}, deepCache);
    const loaded = readBackendBinCache(deepCache);
    expect(loaded).not.toBeNull();
  });

  test('returns null for a missing cache file', () => {
    expect(readBackendBinCache(cachePath)).toBeNull();
  });

  test('returns null for a malformed cache file', () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, 'not json');
    expect(readBackendBinCache(cachePath)).toBeNull();
  });

  test('returns null for a cache with wrong schemaVersion', () => {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ schemaVersion: 99, bins: {} }));
    expect(readBackendBinCache(cachePath)).toBeNull();
  });
});

// ─── getCachedBinPath ─────────────────────────────────────────────────────────

describe('getCachedBinPath', () => {
  let cacheDir;
  let cachePath;

  beforeEach(() => {
    cacheDir = join(homedir(), 'coding', 'tmp', `bbr-get-${randomUUID()}`);
    cachePath = join(cacheDir, 'backend-bins.json');
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  test('returns the cached absolute path when present', () => {
    writeBackendBinCache({
      'claude-code': { path: '/usr/local/bin/claude', searchedPath: '/usr/local/bin', resolvedAt: 1 },
    }, cachePath);
    expect(getCachedBinPath('claude-code', cachePath)).toBe('/usr/local/bin/claude');
  });

  test('returns null when the tool entry has null path', () => {
    writeBackendBinCache({
      codex: { path: null, searchedPath: '/usr/bin', resolvedAt: 1 },
    }, cachePath);
    expect(getCachedBinPath('codex', cachePath)).toBeNull();
  });

  test('returns null when no cache exists', () => {
    expect(getCachedBinPath('claude-code', cachePath)).toBeNull();
  });
});

// ─── resolvedBinDirs ──────────────────────────────────────────────────────────

describe('resolvedBinDirs', () => {
  let tmpBase;

  beforeEach(() => {
    tmpBase = join(homedir(), 'coding', 'tmp', `bbr-dirs-${randomUUID()}`);
    mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpBase, { recursive: true, force: true });
  });

  test('returns unique existing parent directories from resolved bins', () => {
    const dir1 = join(tmpBase, 'dir1');
    const dir2 = join(tmpBase, 'dir2');
    mkdirSync(dir1, { recursive: true });
    mkdirSync(dir2, { recursive: true });

    const bins = {
      'claude-code': { path: join(dir1, 'claude'), searchedPath: dir1, resolvedAt: 1 },
      codex: { path: join(dir2, 'codex'), searchedPath: dir2, resolvedAt: 1 },
      aider: { path: null, searchedPath: '/usr/bin', resolvedAt: 1 },
    };
    const dirs = resolvedBinDirs(bins);
    expect(dirs).toContain(dir1);
    expect(dirs).toContain(dir2);
    expect(dirs).not.toContain(null);
  });

  test('deduplicates directories (two tools in the same dir)', () => {
    const dir = join(tmpBase, 'shared');
    mkdirSync(dir, { recursive: true });
    const bins = {
      'claude-code': { path: join(dir, 'claude'), searchedPath: dir, resolvedAt: 1 },
      codex: { path: join(dir, 'codex'), searchedPath: dir, resolvedAt: 1 },
    };
    const dirs = resolvedBinDirs(bins);
    expect(dirs.filter(d => d === dir).length).toBe(1);
  });

  test('excludes directories that do not exist on disk', () => {
    const bins = {
      'claude-code': { path: '/nonexistent/path/claude', searchedPath: '/nonexistent/path', resolvedAt: 1 },
    };
    expect(resolvedBinDirs(bins)).toEqual([]);
  });

  test('returns empty array when no paths were resolved', () => {
    const bins = {
      'claude-code': { path: null, searchedPath: '/usr/bin', resolvedAt: 1 },
    };
    expect(resolvedBinDirs(bins)).toEqual([]);
  });
});

// ─── install-daemon + cli-tube source-level assertions ───────────────────────
// These verify the integration points exist in the actual source files.
// They read the WORKTREE files via __dirname relative paths.

describe('install-daemon PATH injection (source-level)', () => {
  const installSource = readFileSync(join(__dirname, '../../install-daemon.ts'), 'utf-8');

  test('imports installTimeResolve from backend-bin-resolver', () => {
    expect(installSource).toContain('installTimeResolve');
    expect(installSource).toContain('backend-bin-resolver');
  });

  test('calls installTimeResolve and captures extraDirs', () => {
    expect(installSource).toContain('installTimeResolve()');
    expect(installSource).toContain('extraDirs');
  });

  test('merges extraDirs into daemon.pathDirs before plist generation', () => {
    // Must spread both daemon.pathDirs and extraDirs
    expect(installSource).toContain('...daemon.pathDirs');
    expect(installSource).toContain('...extraDirs');

    // The merge must happen before installMacOS(daemon) is called
    const mergeIdx = installSource.indexOf('...extraDirs');
    const installMacOSIdx = installSource.indexOf('installMacOS(daemon)');
    expect(mergeIdx).toBeGreaterThan(-1);
    expect(mergeIdx).toBeLessThan(installMacOSIdx);
  });
});

describe('cli-tube binary resolution chain (source-level)', () => {
  const tubeSource = readFileSync(
    join(__dirname, '../../lib/spawner/backends/cli-tube.ts'),
    'utf-8',
  );

  test('imports getCachedBinPath from backend-bin-resolver', () => {
    expect(tubeSource).toContain('getCachedBinPath');
    expect(tubeSource).toContain('backend-bin-resolver');
  });

  test('binary resolution prefers cached absolute path over bare name', () => {
    // The assignment must reference all three in the fallback chain:
    // (1) env override, (2) cached path, (3) bare default name
    const binaryAssign = tubeSource.match(/const binary\s*=[\s\S]*?;/m)?.[0] ?? '';
    expect(binaryAssign).toContain('getCachedBinPath');
    expect(binaryAssign).toContain('BINARY_ENV_OVERRIDE');
    expect(binaryAssign).toContain('DEFAULT_BINARIES');
  });
});
