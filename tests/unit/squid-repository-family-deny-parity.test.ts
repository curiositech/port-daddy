import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { stageTentacles } from '../../cli/commands/hooks-install.js';
import { TENTACLES } from '../../lib/squid/hook-shape.js';
import {
  allowSquidWorktree,
  armSquidRepositoryFamily,
  denySquidWorktree,
  inspectSquidRepositoryFamily,
  repositoryFamilyAuthorityLookupId,
  repositoryFamilyDenyPath,
  repositoryFamilyMarkerPath,
  repositoryFamilyVerifierPath,
  repositoryFamilyVerifierDirectory,
  resolveRepositoryFamilyAuthority,
} from '../../lib/squid/repository-family-authority.js';

const SCRATCH_PARENT = join(homedir(), 'coding', 'tmp', 'squid-deny-parity-tests');

function git(cwd: string, ...args: string[]): void {
  execFileSync('/usr/bin/git', ['-C', cwd, ...args], { stdio: 'ignore' });
}

function initializeRepository(root: string): void {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.email', 'squid-deny-parity@example.invalid');
  git(root, 'config', 'user.name', 'Squid Deny Parity Test');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');
}

function invokePromptWrapper(wrapper: string, cwd: string): ReturnType<typeof spawnSync> {
  return spawnSync(wrapper, [], {
    cwd,
    encoding: 'utf8',
    input: '{}\n',
    env: { ...process.env, PD_HOOK_PROVIDER: 'codex' },
  });
}

function exactFileMetadata(path: string): Record<string, number> {
  const stats = lstatSync(path);
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    links: stats.nlink,
    size: stats.size,
    modifiedMs: stats.mtimeMs,
  };
}

describe('Squid per-worktree deny TS/shell parity', () => {
  let scratch = '';

  beforeEach(() => {
    mkdirSync(SCRATCH_PARENT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_PARENT, `deny-parity-${process.pid}-`));
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  test('literal deny authority blocks the staged wrapper while the superseded duplicated path is inert', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    const sourceBin = join(scratch, 'source-bin');
    const pdHome = join(scratch, 'pd-home');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    mkdirSync(sourceBin, { mode: 0o700 });
    for (const name of TENTACLES) {
      writeFileSync(join(sourceBin, name), `#!/bin/sh\nprintf '%s\\n' '${name}'\n`, { mode: 0o755 });
    }
    const stage = stageTentacles(sourceBin, join(pdHome, 'bin'));
    expect(stage.missing).toEqual([]);
    armSquidRepositoryFamily(main, { pdHome });
    writeFileSync(join(pdHome, 'daemon.pid'), '4242\n');
    writeFileSync(join(pdHome, 'daemon.ready'), '4242\n');
    writeFileSync(join(pdHome, 'heartbeat'), 'ready\n');
    const wrapper = join(pdHome, 'bin', 'pd-hook-prompt');
    const authority = resolveRepositoryFamilyAuthority(linked)!;
    const registry = repositoryFamilyVerifierDirectory(pdHome);
    const lookupId = repositoryFamilyAuthorityLookupId(authority);
    const literalPath = join(
      registry,
      'denies',
      lookupId,
      `${authority.worktreeDevice}-${authority.worktreeInode}.v1`,
    );
    const capturedBadDuplicatedPath = join(
      registry,
      registry,
      'denies',
      lookupId,
      `${authority.worktreeDevice}-${authority.worktreeInode}.v1`,
    );

    const allowed = invokePromptWrapper(wrapper, linked);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain('pd-hook-prompt');

    const deny = denySquidWorktree(linked, { pdHome });
    expect(deny.denyPath).toBe(literalPath);
    expect(repositoryFamilyDenyPath(authority, pdHome)).toBe(literalPath);
    expect(existsSync(literalPath)).toBe(true);
    expect(existsSync(capturedBadDuplicatedPath)).toBe(false);
    const validDenyRecord = readFileSync(literalPath, 'utf8');

    const denied = invokePromptWrapper(wrapper, linked);
    expect(denied.status).toBe(0);
    expect(denied.stdout).toBe('');
    expect(inspectSquidRepositoryFamily(linked, { pdHome })).toMatchObject({
      armed: false,
      reason: 'worktree-denied',
    });

    expect(allowSquidWorktree(linked, { pdHome }).allowed).toBe(true);
    mkdirSync(join(capturedBadDuplicatedPath, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(capturedBadDuplicatedPath, validDenyRecord, { mode: 0o600 });

    const oldPathIsInert = invokePromptWrapper(wrapper, linked);
    expect(oldPathIsInert.status).toBe(0);
    expect(oldPathIsInert.stdout).toContain('pd-hook-prompt');
    expect(inspectSquidRepositoryFamily(linked, { pdHome })).toMatchObject({ armed: true, reason: 'armed' });
  });

  test('static ancestry rejection plus concurrent-swap detection leaves only named non-authoritative residue', () => {
    const repo = join(scratch, 'swap-repo');
    const sourceBin = join(scratch, 'swap-source-bin');
    const pdHome = join(scratch, 'swap-pd-home');
    const outside = join(scratch, 'swap-outside');
    initializeRepository(repo);
    mkdirSync(sourceBin, { mode: 0o700 });
    for (const name of TENTACLES) {
      writeFileSync(join(sourceBin, name), `#!/bin/sh\nprintf '%s\\n' '${name}'\n`, { mode: 0o755 });
    }
    const stage = stageTentacles(sourceBin, join(pdHome, 'bin'));
    expect(stage.missing).toEqual([]);
    writeFileSync(join(pdHome, 'daemon.pid'), '4242\n');
    writeFileSync(join(pdHome, 'daemon.ready'), '4242\n');
    writeFileSync(join(pdHome, 'heartbeat'), 'ready\n');
    mkdirSync(outside, { mode: 0o700 });
    const sentinel = join(outside, 'sentinel');
    writeFileSync(sentinel, 'must-not-change\n', { mode: 0o600 });
    const sentinelMetadata = exactFileMetadata(sentinel);
    const generationBytes = readFileSync(stage.generationManifestPath);
    const generationMetadata = exactFileMetadata(stage.generationManifestPath);
    const originalSquid = join(pdHome, 'squid.pinned-original');
    let swapped = false;

    expect(() => armSquidRepositoryFamily(repo, {
      pdHome,
      directoryFault: ({ phase, parent, component }) => {
        if (swapped || phase !== 'after-parent-pin-before-mkdir') return;
        expect(parent).toBe(join(pdHome, 'squid'));
        expect(component).toBe(join(pdHome, 'squid', 'repository-families'));
        renameSync(parent, originalSquid);
        symlinkSync(outside, parent);
        swapped = true;
      },
    })).toThrow(/ancestry changed|not a real directory/);

    expect(swapped).toBe(true);
    const residue = join(outside, 'repository-families');
    expect(readdirSync(outside).sort()).toEqual(['repository-families', 'sentinel']);
    expect(readdirSync(residue)).toEqual([]);
    expect(readFileSync(sentinel, 'utf8')).toBe('must-not-change\n');
    expect(exactFileMetadata(sentinel)).toEqual(sentinelMetadata);
    expect(readFileSync(join(originalSquid, 'hook-wrapper-generation.v1'))).toEqual(generationBytes);
    expect(exactFileMetadata(join(originalSquid, 'hook-wrapper-generation.v1'))).toEqual(generationMetadata);
    expect(existsSync(join(pdHome, 'squid', 'hook-wrapper-generation.v1'))).toBe(false);

    const authority = resolveRepositoryFamilyAuthority(repo)!;
    expect(existsSync(repositoryFamilyVerifierPath(authority, pdHome))).toBe(false);
    expect(existsSync(repositoryFamilyMarkerPath(authority))).toBe(false);
    expect(existsSync(repositoryFamilyDenyPath(authority, pdHome))).toBe(false);
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);
    const hook = invokePromptWrapper(join(pdHome, 'bin', 'pd-hook-prompt'), repo);
    expect(hook.status).toBe(0);
    expect(hook.stdout).toBe('');

    // Detection is fail-closed, not automatic cleanup or hostile same-uid race
    // containment. The exact empty residue remains for operator diagnosis and
    // is never interpreted as a verifier, marker, deny, or generation record.
    expect(readdirSync(residue)).toEqual([]);
  });
});
