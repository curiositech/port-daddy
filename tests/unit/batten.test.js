/**
 * Unit tests for `pd batten` — the declarative release-artifact packing gate.
 *
 * Covers: manifest parse/validation, verify PASSES when all present, verify
 * FAILS LOUD listing EVERY missing/non-exec/too-small artifact (the
 * anti-silent-failure property that generalizes #3496's ad-hoc `test -s`), and
 * imprint producing a stable per-artifact sha256.
 *
 * The pure functions (loadManifest/verifyArtifacts/imprintArtifacts) take a
 * staged dir and never touch the daemon, so a synthetic fixture dir is enough.
 */
import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  loadManifest,
  resolveManifestPath,
  verifyArtifacts,
  imprintArtifacts,
  handleBatten,
} from '../../cli/commands/batten.js';

const DURABLE_SCRATCH = join(homedir(), 'coding', 'tmp');
mkdirSync(DURABLE_SCRATCH, { recursive: true });

// A synthetic manifest mirroring the real shape: a required exec binary, a
// required non-exec data file, a required tentacle under bin/, an optional dir.
function fixtureManifest() {
  return {
    version: 1,
    artifacts: [
      { id: 'pd', stagedPath: 'pd', required: true, executable: true, minBytes: 4 },
      { id: 'manifest', stagedPath: 'port-daddy-manifest.json', required: true, executable: false, minBytes: 2 },
      { id: 'hook', stagedPath: 'bin/pd-hook-prompt', required: true, executable: true, minBytes: 1 },
      { id: 'native', stagedPath: 'native', type: 'dir', required: false, executable: false },
    ],
  };
}

function writeExec(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function writeData(path, contents, mode = 0o644) {
  writeFileSync(path, contents);
  chmodSync(path, mode);
}

describe('loadManifest', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-manifest-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('parses a well-formed manifest', () => {
    const p = join(dir, 'm.json');
    writeFileSync(p, JSON.stringify(fixtureManifest()));
    const m = loadManifest(p);
    expect(m.artifacts).toHaveLength(4);
    expect(m.artifacts.map((a) => a.id)).toContain('pd');
  });

  test('the real repo release-artifacts.json parses and declares the #3496 cargo', () => {
    const real = loadManifest(resolveManifestPath());
    const ids = real.artifacts.map((a) => a.id);
    // The silent-failure class this system closes: tentacles + hooks + the
    // pkgshare payloads (`pd setup`'s skill + Pilot sources). pd-bosun left the
    // cargo with the 3.28 single-supervisor cutover — the tap formula's tarball
    // gate now REJECTS a >=3.28.0 tarball that carries it, so asserting its
    // presence here would ship a brew-breaking release.
    for (const id of ['pd', 'port-daddy', 'pd-hook-prompt', 'pd-hook-pre-tool', 'pd-hook-post-tool', 'pd-hook-stop', 'sessionstart-pilot', 'agent-skill', 'pilot-agent']) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain('pd-bosun');
    // Tentacles ship ONLY under bin/ — a flat top-level stagedPath would fail
    // the formula's tarball-entry hash.
    for (const a of real.artifacts) {
      if (a.id.startsWith('pd-hook-')) expect(a.stagedPath).toBe(`bin/${a.id}`);
    }
  });

  test('falls back to the module-relative repo manifest outside the repo cwd', () => {
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const fallback = resolveManifestPath();
      expect(fallback).toMatch(/release-artifacts\.json$/);
      expect(existsSync(fallback)).toBe(true);
      expect(loadManifest(fallback).artifacts.length).toBeGreaterThan(0);
    } finally {
      process.chdir(previousCwd);
    }
  });

  test('rejects a manifest without an artifacts array', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, JSON.stringify({ version: 1 }));
    expect(() => loadManifest(p)).toThrow(/artifacts.*array/i);
  });

  test('rejects duplicate artifact ids', () => {
    const p = join(dir, 'dup.json');
    writeFileSync(p, JSON.stringify({
      artifacts: [
        { id: 'pd', stagedPath: 'pd' },
        { id: 'pd', stagedPath: 'pd2' },
      ],
    }));
    expect(() => loadManifest(p)).toThrow(/duplicate/i);
  });

  test('rejects an artifact missing stagedPath', () => {
    const p = join(dir, 'nostaged.json');
    writeFileSync(p, JSON.stringify({ artifacts: [{ id: 'pd' }] }));
    expect(() => loadManifest(p)).toThrow(/stagedPath/);
  });

  test('rejects invalid JSON', () => {
    const p = join(dir, 'broken.json');
    writeFileSync(p, '{ not json');
    expect(() => loadManifest(p)).toThrow(/valid JSON/i);
  });
});

describe('verifyArtifacts — passing path', () => {
  let staged;
  beforeEach(() => {
    staged = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-ok-'));
    writeExec(join(staged, 'pd'), 'ELF-ish binary bytes');
    writeData(join(staged, 'port-daddy-manifest.json'), '{"files":[]}');
    mkdirSync(join(staged, 'bin'));
    writeExec(join(staged, 'bin', 'pd-hook-prompt'), '#!/bin/sh\necho hi\n');
    mkdirSync(join(staged, 'native'));
    writeFileSync(join(staged, 'native', 'libonnxruntime.so.1'), 'x');
  });
  afterEach(() => {
    rmSync(staged, { recursive: true, force: true });
  });

  test('reports ok with zero failures when every required artifact is valid', () => {
    const report = verifyArtifacts(fixtureManifest(), staged);
    expect(report.ok).toBe(true);
    expect(report.failedRequired).toEqual([]);
    for (const r of report.results) {
      expect(r.failures).toEqual([]);
    }
  });

  test('an ABSENT optional artifact is not a failure', () => {
    rmSync(join(staged, 'native'), { recursive: true, force: true });
    const report = verifyArtifacts(fixtureManifest(), staged);
    expect(report.ok).toBe(true);
    const nativeResult = report.results.find((r) => r.id === 'native');
    expect(nativeResult.present).toBe(false);
    expect(nativeResult.failures).toEqual([]);
  });

  test('a present optional directory is still inspected and reports when empty', () => {
    rmSync(join(staged, 'native'), { recursive: true, force: true });
    mkdirSync(join(staged, 'native'));
    const report = verifyArtifacts(fixtureManifest(), staged);
    expect(report.ok).toBe(true);
    const nativeResult = report.results.find((r) => r.id === 'native');
    expect(nativeResult.present).toBe(true);
    expect(nativeResult.failures.join(' ')).toMatch(/empty/i);
  });
});

describe('verifyArtifacts — FAILS LOUD (anti-silent-failure)', () => {
  let staged;
  beforeEach(() => {
    staged = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-fail-'));
    // pd: MISSING entirely (do not write it)
    // manifest: present but TOO SMALL (< minBytes 2)
    writeData(join(staged, 'port-daddy-manifest.json'), 'x'); // 1 byte < 2
    // hook: present but NOT EXECUTABLE
    mkdirSync(join(staged, 'bin'));
    writeData(join(staged, 'bin', 'pd-hook-prompt'), '#!/bin/sh\n', 0o644);
  });
  afterEach(() => {
    rmSync(staged, { recursive: true, force: true });
  });

  test('collects EVERY failure — missing AND too-small AND non-exec, not just the first', () => {
    const report = verifyArtifacts(fixtureManifest(), staged);
    expect(report.ok).toBe(false);
    // All three distinct required artifacts must be reported — the whole point:
    // no single silent omission slips through because an earlier one failed.
    expect(report.failedRequired.sort()).toEqual(['hook', 'manifest', 'pd']);

    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
    expect(byId.pd.present).toBe(false);
    expect(byId.pd.failures.join(' ')).toMatch(/missing/i);
    expect(byId.manifest.failures.join(' ')).toMatch(/too small/i);
    expect(byId.hook.failures.join(' ')).toMatch(/not executable/i);
  });

  test('a directory found where a file is expected fails loudly', () => {
    // Replace the missing pd with a DIRECTORY named pd.
    mkdirSync(join(staged, 'pd'));
    const report = verifyArtifacts(fixtureManifest(), staged);
    const pd = report.results.find((r) => r.id === 'pd');
    expect(pd.failures.join(' ')).toMatch(/found a directory/i);
    expect(report.ok).toBe(false);
  });

  test('an empty required directory fails', () => {
    const manifest = {
      artifacts: [{ id: 'native', stagedPath: 'native', type: 'dir', required: true }],
    };
    mkdirSync(join(staged, 'native')); // empty
    const report = verifyArtifacts(manifest, staged);
    expect(report.ok).toBe(false);
    expect(report.results[0].failures.join(' ')).toMatch(/empty/i);
  });

  (process.platform === 'win32' ? test.skip : test)('an unreadable required directory is reported instead of crashing', () => {
    const manifest = {
      artifacts: [{ id: 'native', stagedPath: 'native', type: 'dir', required: true }],
    };
    mkdirSync(join(staged, 'native'));
    chmodSync(join(staged, 'native'), 0o000);
    try {
      expect(() => verifyArtifacts(manifest, staged)).not.toThrow();
      const report = verifyArtifacts(manifest, staged);
      expect(report.ok).toBe(false);
      expect(report.results[0].failures.join(' ')).toMatch(/cannot read directory/i);
    } finally {
      chmodSync(join(staged, 'native'), 0o755);
    }
  });
});

describe('imprintArtifacts — content-addressed seal', () => {
  let staged;
  beforeEach(() => {
    staged = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-imprint-'));
    writeExec(join(staged, 'pd'), 'binary-A');
    writeData(join(staged, 'port-daddy-manifest.json'), '{"files":[1]}');
    mkdirSync(join(staged, 'bin'));
    writeExec(join(staged, 'bin', 'pd-hook-prompt'), '#!/bin/sh\n');
    mkdirSync(join(staged, 'native'));
    writeFileSync(join(staged, 'native', 'lib.so'), 'x');
  });
  afterEach(() => {
    rmSync(staged, { recursive: true, force: true });
  });

  test('produces a per-artifact sha256 that matches an independent hash', () => {
    const record = imprintArtifacts(fixtureManifest(), staged);
    const expected = createHash('sha256').update(Buffer.from('binary-A')).digest('hex');
    expect(record.artifacts.pd.sha256).toBe(expected);
    expect(record.artifacts.pd.bytes).toBe(Buffer.byteLength('binary-A'));
    expect(record.artifacts.pd.stagedPath).toBe('pd');
  });

  test('is stable — hashing the same bytes twice yields identical hashes', () => {
    const a = imprintArtifacts(fixtureManifest(), staged);
    const b = imprintArtifacts(fixtureManifest(), staged);
    expect(b.artifacts.pd.sha256).toBe(a.artifacts.pd.sha256);
    expect(b.artifacts.manifest.sha256).toBe(a.artifacts.manifest.sha256);
    expect(b.artifacts.hook.sha256).toBe(a.artifacts.hook.sha256);
  });

  test('directory artifacts are not imprinted (no single stable hash)', () => {
    const record = imprintArtifacts(fixtureManifest(), staged);
    expect(record.artifacts.native).toBeUndefined();
    expect(record.missingRequired).toEqual([]); // native is optional
  });

  test('records required artifacts that are absent (an unsealed release)', () => {
    rmSync(join(staged, 'pd'));
    const record = imprintArtifacts(fixtureManifest(), staged);
    expect(record.missingRequired).toContain('pd');
    expect(record.artifacts.pd).toBeUndefined();
  });
});

describe('handleBatten imprint — fail-loud CLI contract', () => {
  let root;
  let staged;
  let manifestPath;
  let outPath;
  let realExit;

  beforeEach(() => {
    root = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-cli-imprint-'));
    staged = join(root, 'dist');
    mkdirSync(staged);
    manifestPath = join(root, 'release-artifacts.json');
    outPath = join(staged, 'release-imprint.json');
    writeFileSync(manifestPath, JSON.stringify(fixtureManifest()));
    realExit = process.exit;
  });

  afterEach(() => {
    process.exit = realExit;
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test('help names both canonical subcommands without exiting', async () => {
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    await handleBatten(['help'], {});
    const output = stdout.mock.calls.flat().join('\n');
    expect(output).toMatch(/pd batten verify/);
    expect(output).toMatch(/pd batten imprint/);
  });

  test('unknown subcommands print usage and exit 1', async () => {
    process.exit = jest.fn((code) => { throw new Error(`exit:${code}`); });
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(handleBatten(['wat'], {})).rejects.toThrow('exit:1');
    expect(process.exit).toHaveBeenCalledWith(1);
    expect([...stdout.mock.calls, ...stderr.mock.calls].flat().join(' ')).toMatch(/unknown batten subcommand: wat/i);
    expect(stdout.mock.calls.flat().join(' ')).toMatch(/pd batten verify/i);
  });

  test('verify subcommand parses options and runs the real artifact gate', async () => {
    writeExec(join(staged, 'pd'), 'binary-A');
    writeData(join(staged, 'port-daddy-manifest.json'), '{"files":[1]}');
    mkdirSync(join(staged, 'bin'));
    writeExec(join(staged, 'bin', 'pd-hook-prompt'), '#!/bin/sh\n');
    const exit = jest.fn();
    process.exit = exit;
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    await handleBatten(['verify'], { manifest: manifestPath, 'staged-dir': staged });
    expect(exit).not.toHaveBeenCalled();
    expect([...stdout.mock.calls, ...stderr.mock.calls].flat().join(' ')).toMatch(/All required release artifacts present and valid/i);
  });

  test('writes the incomplete receipt, warns, and exits 1 when required cargo is absent', async () => {
    const exit = jest.fn((code) => {
      throw new Error(`exit:${code}`);
    });
    process.exit = exit;
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(handleBatten(['imprint'], {
      manifest: manifestPath,
      'staged-dir': staged,
      out: outPath,
    })).rejects.toThrow('exit:1');

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr.mock.calls.flat().join(' ')).toMatch(/required artifacts absent/i);
    expect([...stdout.mock.calls, ...stderr.mock.calls].flat().join(' ')).not.toMatch(/SUCCESS: Wrote imprint/i);
    expect([...stdout.mock.calls, ...stderr.mock.calls].flat().join(' ')).toMatch(/INCOMPLETE imprint/i);
    expect(existsSync(outPath)).toBe(true);
    const record = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(record.missingRequired.sort()).toEqual(['hook', 'manifest', 'pd']);
    stdout.mockRestore();
    stderr.mockRestore();
  });
});

// The Homebrew tap's release-evidence verifier compares imprint.sourceCommit
// against the candidate commit it is asked to roll and refuses the formula
// update on a mismatch. It was never emitted, so v3.28.0 built, signed,
// notarized and published GREEN, then failed in the tap with "sourceCommit
// does not match candidate" — leaving every brew user on 3.27.0. Pin it.
describe('imprintArtifacts — sourceCommit (the tap release-evidence contract)', () => {
  let staged;
  const oneArtifact = {
    version: 1,
    artifacts: [{ id: 'pd', stagedPath: 'pd', required: true, executable: true, minBytes: 1 }],
  };
  beforeEach(() => {
    staged = mkdtempSync(join(DURABLE_SCRATCH, 'pd-batten-commit-'));
    writeExec(join(staged, 'pd'), '#!/bin/sh\necho hi\n');
  });
  afterEach(() => {
    rmSync(staged, { recursive: true, force: true });
  });

  test('records a full lowercase commit sha', () => {
    const record = imprintArtifacts(oneArtifact, staged);
    expect(record).toHaveProperty('sourceCommit');
    expect(record.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  // The tap's verify-port-daddy-release-evidence.py requires FOUR things of an
  // imprint: sourceCommit === candidate, releaseVersion === tag,
  // missingRequired === [], and exactly one sealed `archives` entry for the
  // uploaded tarball whose sha256/bytes match the file on disk. Emitting three
  // of four is a failed roll — v3.28.0 died on sourceCommit and v3.28.1 on
  // releaseVersion, each a separate published-but-unrollable release. Pin all
  // four together so the next gap fails here, not in another repo.
  test('seals the full evidence the tap verifier requires', () => {
    const archive = join(staged, 'pd-darwin-arm64.tar.gz');
    writeFileSync(archive, 'tarball-bytes-here');
    const record = imprintArtifacts(oneArtifact, staged, {
      releaseVersion: 'v9.9.9',
      archives: ['pd-darwin-arm64.tar.gz'],
    });
    expect(record.releaseVersion).toBe('v9.9.9');
    expect(record.missingRequired).toEqual([]);
    expect(record.archives).toHaveLength(1);
    const [sealed] = record.archives;
    expect(sealed.name).toBe('pd-darwin-arm64.tar.gz');
    expect(sealed.bytes).toBe(readFileSync(archive).length);
    expect(sealed.sha256).toBe(
      createHash('sha256').update(readFileSync(archive)).digest('hex'),
    );
  });

  test('releaseVersion is null — not a guess — when the tag is not supplied', () => {
    const record = imprintArtifacts(oneArtifact, staged);
    expect(record.releaseVersion).toBeNull();
    expect(record.archives).toEqual([]);
  });

  test('prefers GITHUB_SHA — the commit the tag build actually ships', () => {
    const prev = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = 'a'.repeat(40);
    try {
      expect(imprintArtifacts(oneArtifact, staged).sourceCommit).toBe('a'.repeat(40));
    } finally {
      if (prev === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = prev;
    }
  });

  test('ignores a malformed GITHUB_SHA rather than emitting junk evidence', () => {
    const prev = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = 'not-a-sha';
    try {
      expect(imprintArtifacts(oneArtifact, staged).sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      if (prev === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = prev;
    }
  });
});
