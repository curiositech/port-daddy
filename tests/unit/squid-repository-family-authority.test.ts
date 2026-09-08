import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  allowSquidWorktree,
  acquireRepositoryFamilyMutationLock,
  armSquidRepositoryFamily,
  denySquidWorktree,
  disarmSquidRepositoryFamily,
  inspectSquidRepositoryFamily,
  inspectRepositoryFamilyMutationLock,
  listVerifiedRepositoryFamilyWorktrees,
  parseLinuxProcStatStartToken,
  repositoryFamilyAuthorityLookupId,
  repositoryFamilyDenyPath,
  repositoryFamilyMarkerPath,
  repositoryFamilyMutationLockPath,
  repositoryFamilyVerifierPath,
  resolveRepositoryFamilyAuthority,
  transactSquidRepositoryFamilyArm,
} from '../../lib/squid/repository-family-authority.js';

const SCRATCH_PARENT = join(homedir(), 'coding', 'tmp', 'squid-repository-family-tests');

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function initializeRepository(root: string): void {
  mkdirSync(root, { recursive: true });
  git(root, 'init', '--initial-branch=main');
  git(root, 'config', 'user.email', 'squid-authority@example.invalid');
  git(root, 'config', 'user.name', 'Squid Authority Test');
  writeFileSync(join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');
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

describe('Squid repository-family authority', () => {
  let scratch = '';
  let pdHome = '';

  beforeEach(() => {
    mkdirSync(SCRATCH_PARENT, { recursive: true });
    scratch = mkdtempSync(join(SCRATCH_PARENT, `squid-family-${process.pid}-`));
    pdHome = join(scratch, 'pd-home');
    mkdirSync(pdHome, { recursive: true, mode: 0o700 });
  });

  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  test('arming main automatically covers existing and future linked worktrees without mutating the verifier registry', () => {
    const main = join(scratch, 'main');
    const existing = join(scratch, 'existing');
    const future = join(scratch, 'future');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'existing', existing);

    const armed = armSquidRepositoryFamily(main, { pdHome });
    expect(inspectSquidRepositoryFamily(existing, { pdHome })).toMatchObject({
      armed: true,
      localRepositoryId: armed.localRepositoryId,
      kind: 'git',
    });
    const registryBefore = readdirSync(join(pdHome, 'squid', 'repository-families')).sort();

    git(main, 'worktree', 'add', '-b', 'future', future);

    expect(readdirSync(join(pdHome, 'squid', 'repository-families')).sort()).toEqual(registryBefore);
    expect(inspectSquidRepositoryFamily(future, { pdHome })).toMatchObject({
      armed: true,
      localRepositoryId: armed.localRepositoryId,
      kind: 'git',
    });
  });

  test('same remote URL grants nothing to an unrelated clone', () => {
    const source = join(scratch, 'source');
    const remote = join(scratch, 'remote.git');
    const first = join(scratch, 'first');
    const second = join(scratch, 'second');
    initializeRepository(source);
    execFileSync('git', ['clone', '--bare', source, remote]);
    execFileSync('git', ['clone', remote, first]);
    execFileSync('git', ['clone', remote, second]);
    expect(git(first, 'remote', 'get-url', 'origin')).toBe(git(second, 'remote', 'get-url', 'origin'));

    armSquidRepositoryFamily(first, { pdHome });

    expect(inspectSquidRepositoryFamily(first, { pdHome }).armed).toBe(true);
    expect(inspectSquidRepositoryFamily(second, { pdHome })).toMatchObject({ armed: false });
  });

  test('forged linked-worktree metadata cannot point a foreign root at an armed common directory', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    const forged = join(scratch, 'forged');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    armSquidRepositoryFamily(main, { pdHome });
    mkdirSync(forged);
    copyFileSync(join(linked, '.git'), join(forged, '.git'));

    expect(inspectSquidRepositoryFamily(forged, { pdHome })).toMatchObject({
      armed: false,
    });
  });

  test.each([
    ['missing commondir', (admin: string) => rmSync(join(admin, 'commondir'))],
    ['tampered commondir', (admin: string) => writeFileSync(join(admin, 'commondir'), '..\n')],
    ['symlinked commondir', (admin: string) => {
      const path = join(admin, 'commondir');
      renameSync(path, `${path}.target`);
      symlinkSync(`${path}.target`, path);
    }],
    ['missing gitdir backpointer', (admin: string) => rmSync(join(admin, 'gitdir'))],
    ['tampered gitdir backpointer', (admin: string) => writeFileSync(join(admin, 'gitdir'), '/foreign/.git\n')],
    ['symlinked gitdir backpointer', (admin: string) => {
      const path = join(admin, 'gitdir');
      renameSync(path, `${path}.target`);
      symlinkSync(`${path}.target`, path);
    }],
  ])('linked worktree rejects %s', (_label, mutate) => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    armSquidRepositoryFamily(main, { pdHome });
    const gitdirLine = readFileSync(join(linked, '.git'), 'utf8').trim();
    const admin = gitdirLine.slice('gitdir: '.length);
    mutate(admin);

    expect(resolveRepositoryFamilyAuthority(linked)).toBeNull();
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(false);
  });

  test('a nested foreign Git repository stops inherited family activation', () => {
    const outer = join(scratch, 'outer');
    const nested = join(outer, 'packages', 'foreign');
    initializeRepository(outer);
    armSquidRepositoryFamily(outer, { pdHome });
    initializeRepository(nested);

    expect(inspectSquidRepositoryFamily(join(outer, 'packages'), { pdHome }).armed).toBe(true);
    expect(inspectSquidRepositoryFamily(nested, { pdHome }).armed).toBe(false);
  });

  test.each(['.git', '.portdaddy'])(
    'a dangling nested %s boundary cannot fall through to an armed parent',
    (boundary) => {
      const outer = join(scratch, 'outer-dangling');
      const nested = join(outer, 'packages', boundary === '.git' ? 'git-child' : 'pd-child');
      initializeRepository(outer);
      armSquidRepositoryFamily(outer, { pdHome });
      mkdirSync(nested, { recursive: true });
      symlinkSync(join(scratch, 'missing-boundary-target'), join(nested, boundary));

      expect(resolveRepositoryFamilyAuthority(nested)).toBeNull();
      expect(inspectSquidRepositoryFamily(nested, { pdHome }).armed).toBe(false);
    },
  );

  test('a symlinked deny parent fails closed instead of bypassing the worktree privacy override', () => {
    const repo = join(scratch, 'deny-parent-repo');
    const outside = join(scratch, 'outside-denies');
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    mkdirSync(outside, { mode: 0o700 });
    const denyRoot = join(pdHome, 'squid', 'repository-families', 'denies');
    symlinkSync(outside, denyRoot);

    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({
      armed: false,
      reason: 'deny-directory-symlink',
    });
  });

  test('copied marker and verifier records still cannot arm another repository', () => {
    const first = join(scratch, 'first');
    const second = join(scratch, 'second');
    initializeRepository(first);
    initializeRepository(second);
    armSquidRepositoryFamily(first, { pdHome });
    const firstAuthority = resolveRepositoryFamilyAuthority(first)!;
    const secondAuthority = resolveRepositoryFamilyAuthority(second)!;
    mkdirSync(join(secondAuthority.authorityRoot, 'port-daddy'), { recursive: true });
    copyFileSync(
      repositoryFamilyMarkerPath(firstAuthority),
      repositoryFamilyMarkerPath(secondAuthority),
    );
    copyFileSync(
      repositoryFamilyVerifierPath(firstAuthority, pdHome),
      repositoryFamilyVerifierPath(secondAuthority, pdHome),
    );

    expect(inspectSquidRepositoryFamily(second, { pdHome })).toMatchObject({
      armed: false,
      reason: 'authority-binding-mismatch',
    });
  });

  test('the verifier lookup is derived from authority before any repository marker is read', () => {
    const first = join(scratch, 'first');
    const second = join(scratch, 'second');
    initializeRepository(first);
    initializeRepository(second);
    armSquidRepositoryFamily(first, { pdHome });
    const firstAuthority = resolveRepositoryFamilyAuthority(first)!;
    const secondAuthority = resolveRepositoryFamilyAuthority(second)!;
    mkdirSync(join(secondAuthority.authorityRoot, 'port-daddy'), { recursive: true });
    copyFileSync(repositoryFamilyMarkerPath(firstAuthority), repositoryFamilyMarkerPath(secondAuthority));

    expect(repositoryFamilyAuthorityLookupId(firstAuthority)).not.toBe(repositoryFamilyAuthorityLookupId(secondAuthority));
    expect(repositoryFamilyVerifierPath(firstAuthority, pdHome)).not.toBe(repositoryFamilyVerifierPath(secondAuthority, pdHome));
    expect(inspectSquidRepositoryFamily(second, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-missing' });
  });

  test.each([
    ['duplicate record', (valid: string) => `${valid}${valid}`],
    ['unknown trailing field', (valid: string) => `${valid.trimEnd()}\tunknown=value\n`],
    ['trailing record', (valid: string) => `${valid}v1\tgit\textra\n`],
    ['embedded NUL', (valid: string) => `${valid.trimEnd()}\0\n`],
    ['oversize record', () => `v1\t${'x'.repeat(5_000)}\n`],
    ['malformed record', () => 'not-a-record\n'],
  ])('%s verifier content fails closed', (_label, mutate) => {
    const repo = join(scratch, 'repo');
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    const authority = resolveRepositoryFamilyAuthority(repo)!;
    const verifier = repositoryFamilyVerifierPath(authority, pdHome);
    const valid = readFileSync(verifier, 'utf8');
    writeFileSync(verifier, mutate(valid));
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-malformed' });
  });

  test('permissive, symlinked, and hardlinked verifier records fail closed', () => {
    const repo = join(scratch, 'repo');
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    const authority = resolveRepositoryFamilyAuthority(repo)!;
    const verifier = repositoryFamilyVerifierPath(authority, pdHome);

    chmodSync(verifier, 0o644);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-mode-invalid' });
    chmodSync(verifier, 0o600);
    const hardlink = `${verifier}.hardlink`;
    linkSync(verifier, hardlink);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-hardlink' });
    rmSync(hardlink);
    const target = `${verifier}.target`;
    renameSync(verifier, target);
    symlinkSync(target, verifier);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-symlink' });
  });

  test('symlinked marker, git metadata, and verifier registry all fail closed', () => {
    const repo = join(scratch, 'repo');
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    const authority = resolveRepositoryFamilyAuthority(repo)!;
    const marker = repositoryFamilyMarkerPath(authority);
    const markerTarget = `${marker}.target`;
    renameSync(marker, markerTarget);
    symlinkSync(markerTarget, marker);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'marker-symlink' });

    rmSync(marker);
    renameSync(markerTarget, marker);
    const registry = join(pdHome, 'squid', 'repository-families');
    const registryTarget = `${registry}.target`;
    renameSync(registry, registryTarget);
    symlinkSync(registryTarget, registry);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({ armed: false, reason: 'verifier-registry-symlink' });

    const gitMeta = join(repo, '.git');
    const gitTarget = `${gitMeta}.target`;
    renameSync(gitMeta, gitTarget);
    symlinkSync(gitTarget, gitMeta);
    expect(resolveRepositoryFamilyAuthority(repo)).toBeNull();
    expect(repositoryFamilyVerifierPath(authority, pdHome)).toContain(repositoryFamilyAuthorityLookupId(authority));
  });

  test.each([
    ['pd-home', (outside: string) => {
      rmSync(pdHome, { recursive: true, force: true });
      symlinkSync(outside, pdHome);
    }],
    ['squid state directory', (outside: string) => {
      symlinkSync(outside, join(pdHome, 'squid'));
    }],
    ['repository-family registry', (outside: string) => {
      mkdirSync(join(pdHome, 'squid'), { mode: 0o700 });
      symlinkSync(outside, join(pdHome, 'squid', 'repository-families'));
    }],
  ])('arming rejects a symlinked %s ancestry before creating anything outside authority', (_label, forge) => {
    const repo = join(scratch, `repo-${_label.replaceAll(' ', '-')}`);
    const outside = join(scratch, `outside-${_label.replaceAll(' ', '-')}`);
    initializeRepository(repo);
    mkdirSync(outside, { mode: 0o700 });
    const sentinel = join(outside, 'sentinel');
    writeFileSync(sentinel, 'unchanged\n');
    forge(outside);
    const before = readdirSync(outside).sort();
    const sentinelMetadata = exactFileMetadata(sentinel);

    expect(() => armSquidRepositoryFamily(repo, { pdHome })).toThrow();

    expect(readdirSync(outside).sort()).toEqual(before);
    expect(readFileSync(sentinel, 'utf8')).toBe('unchanged\n');
    expect(exactFileMetadata(sentinel)).toEqual(sentinelMetadata);
  });

  test('arming rejects a symlinked Git marker parent without publishing verifier or outside bytes', () => {
    const repo = join(scratch, 'marker-parent-arm-repo');
    const outside = join(scratch, 'marker-parent-arm-outside');
    initializeRepository(repo);
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(outside, 'sentinel'), 'unchanged\n');
    symlinkSync(outside, join(repo, '.git', 'port-daddy'));
    const authority = resolveRepositoryFamilyAuthority(repo)!;
    const sentinelMetadata = exactFileMetadata(join(outside, 'sentinel'));

    expect(() => armSquidRepositoryFamily(repo, { pdHome })).toThrow('marker directory is not trustworthy');

    expect(readdirSync(outside)).toEqual(['sentinel']);
    expect(exactFileMetadata(join(outside, 'sentinel'))).toEqual(sentinelMetadata);
    expect(existsSync(repositoryFamilyVerifierPath(authority, pdHome))).toBe(false);
  });

  test.each(['denies', 'family'])('a symlinked %s deny ancestor cannot receive an outside record', (position) => {
    const repo = join(scratch, `deny-ancestry-${position}`);
    const outside = join(scratch, `deny-ancestry-${position}-outside`);
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(join(outside, 'sentinel'), 'unchanged\n');
    const authority = resolveRepositoryFamilyAuthority(repo)!;
    const denies = join(pdHome, 'squid', 'repository-families', 'denies');
    if (position === 'denies') {
      symlinkSync(outside, denies);
    } else {
      mkdirSync(denies, { mode: 0o700 });
      symlinkSync(outside, join(denies, repositoryFamilyAuthorityLookupId(authority)));
    }
    const before = readdirSync(outside).sort();
    const sentinelMetadata = exactFileMetadata(join(outside, 'sentinel'));

    expect(() => denySquidWorktree(repo, { pdHome })).toThrow();

    expect(readdirSync(outside).sort()).toEqual(before);
    expect(readFileSync(join(outside, 'sentinel'), 'utf8')).toBe('unchanged\n');
    expect(exactFileMetadata(join(outside, 'sentinel'))).toEqual(sentinelMetadata);
  });

  test('mutation-lock setup and legacy retirement never traverse a symlinked state parent', () => {
    const repo = join(scratch, 'lock-ancestry-repo');
    const outside = join(scratch, 'lock-ancestry-outside');
    initializeRepository(repo);
    const armed = armSquidRepositoryFamily(repo, { pdHome });
    const safeSquid = join(pdHome, 'squid.safe');
    renameSync(join(pdHome, 'squid'), safeSquid);
    mkdirSync(outside, { mode: 0o700 });
    const legacy = join(outside, 'projects');
    writeFileSync(legacy, 'legacy-must-survive\n');
    symlinkSync(outside, join(pdHome, 'squid'));
    const outsideBefore = readdirSync(outside).sort();
    const legacyMetadata = exactFileMetadata(legacy);

    expect(() => acquireRepositoryFamilyMutationLock(pdHome)).toThrow();
    expect(() => disarmSquidRepositoryFamily(repo, { pdHome })).toThrow();

    expect(readdirSync(outside).sort()).toEqual(outsideBefore);
    expect(readFileSync(legacy, 'utf8')).toBe('legacy-must-survive\n');
    expect(exactFileMetadata(legacy)).toEqual(legacyMetadata);
    expect(existsSync(repositoryFamilyMarkerPath(armed.authority))).toBe(true);
  });

  test('a worktree moved through Git keeps family authority while its stale path does not', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    const moved = join(scratch, 'moved');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    const armed = armSquidRepositoryFamily(main, { pdHome });
    git(main, 'worktree', 'move', linked, moved);

    expect(existsSync(linked)).toBe(false);
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(false);
    expect(inspectSquidRepositoryFamily(moved, { pdHome })).toMatchObject({
      armed: true,
      localRepositoryId: armed.localRepositoryId,
    });
  });

  test('moving a repository does not change inode authority, while recreating the old path does', () => {
    const repo = join(scratch, 'repo');
    const moved = join(scratch, 'moved');
    initializeRepository(repo);
    const armed = armSquidRepositoryFamily(repo, { pdHome });
    renameSync(repo, moved);
    mkdirSync(repo);

    expect(inspectSquidRepositoryFamily(moved, { pdHome })).toMatchObject({
      armed: true,
      localRepositoryId: armed.localRepositoryId,
    });
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);
  });

  test('one sensitive worktree can deny hooks without affecting siblings, and the deny follows a Git move', () => {
    const main = join(scratch, 'main');
    const first = join(scratch, 'first');
    const moved = join(scratch, 'moved');
    const sibling = join(scratch, 'sibling');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'first', first);
    git(main, 'worktree', 'add', '-b', 'sibling', sibling);
    armSquidRepositoryFamily(main, { pdHome });

    const denied = denySquidWorktree(first, { pdHome });
    expect(existsSync(repositoryFamilyDenyPath(resolveRepositoryFamilyAuthority(first)!, pdHome))).toBe(true);
    expect(inspectSquidRepositoryFamily(first, { pdHome })).toMatchObject({ armed: false, reason: 'worktree-denied' });
    expect(inspectSquidRepositoryFamily(main, { pdHome }).armed).toBe(true);
    expect(inspectSquidRepositoryFamily(sibling, { pdHome }).armed).toBe(true);

    git(main, 'worktree', 'move', first, moved);
    expect(inspectSquidRepositoryFamily(moved, { pdHome })).toMatchObject({
      armed: false,
      reason: 'worktree-denied',
      localRepositoryId: denied.localRepositoryId,
    });
    expect(allowSquidWorktree(moved, { pdHome }).allowed).toBe(true);
    expect(inspectSquidRepositoryFamily(moved, { pdHome }).armed).toBe(true);
  });

  test('a removed and recreated worktree at the same path receives a new identity and does not inherit the old deny', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'old-linked', linked);
    armSquidRepositoryFamily(main, { pdHome });
    const oldIdentity = resolveRepositoryFamilyAuthority(linked)!;
    denySquidWorktree(linked, { pdHome });
    git(main, 'worktree', 'remove', '--force', linked);
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(false);
    git(main, 'worktree', 'add', '-b', 'new-linked', linked);
    const newIdentity = resolveRepositoryFamilyAuthority(linked)!;

    expect([newIdentity.worktreeDevice, newIdentity.worktreeInode]).not.toEqual([
      oldIdentity.worktreeDevice,
      oldIdentity.worktreeInode,
    ]);
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(true);
  });

  test('a replacement worktree at a different path cannot inherit a removed worktree deny', () => {
    const main = join(scratch, 'main');
    const oldPath = join(scratch, 'old-path');
    const replacement = join(scratch, 'replacement');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'old-path', oldPath);
    armSquidRepositoryFamily(main, { pdHome });
    denySquidWorktree(oldPath, { pdHome });
    git(main, 'worktree', 'remove', '--force', oldPath);
    git(main, 'worktree', 'add', '-b', 'replacement', replacement);

    expect(inspectSquidRepositoryFamily(replacement, { pdHome }).armed).toBe(true);
  });

  test('pruned or deleted worktree metadata cannot retain activation', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    armSquidRepositoryFamily(main, { pdHome });
    rmSync(linked, { recursive: true, force: true });
    git(main, 'worktree', 'prune', '--expire', 'now');

    expect(resolveRepositoryFamilyAuthority(linked)).toBeNull();
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(false);
  });

  test('permissive registry directories and a busy mutation lock fail closed', () => {
    const repo = join(scratch, 'repo');
    initializeRepository(repo);
    armSquidRepositoryFamily(repo, { pdHome });
    const registry = join(pdHome, 'squid', 'repository-families');
    chmodSync(registry, 0o755);
    expect(inspectSquidRepositoryFamily(repo, { pdHome })).toMatchObject({
      armed: false,
      reason: 'verifier-registry-mode-invalid',
    });

    disarmSquidRepositoryFamily(repo, { pdHome });
    chmodSync(registry, 0o700);
    mkdirSync(repositoryFamilyMutationLockPath(pdHome));
    expect(() => armSquidRepositoryFamily(repo, { pdHome })).toThrow(/mutation lock/i);
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);
  });

  test('verifier-first arm and revoke-first disarm stay inactive across injected failures', () => {
    const repo = join(scratch, 'repo');
    initializeRepository(repo);
    expect(() => armSquidRepositoryFamily(repo, {
      pdHome,
      fault: (point) => {
        if (point === 'after-verifier-commit') throw new Error('injected arm interruption');
      },
    })).toThrow('injected arm interruption');
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);

    const retry = armSquidRepositoryFamily(repo, { pdHome });
    expect(retry.armed).toBe(true);
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(true);
    expect(() => disarmSquidRepositoryFamily(repo, {
      pdHome,
      fault: (point) => {
        if (point === 'after-verifier-remove') throw new Error('injected off interruption');
      },
    })).toThrow('injected off interruption');
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);
  });

  test('provider preparation is compensated before marker commit, while an after-marker error resolves by exact readback', () => {
    const repo = join(scratch, 'transaction-repo');
    initializeRepository(repo);
    let beforeRollback = 0;
    expect(() => transactSquidRepositoryFamilyArm(repo, {
      pdHome,
      fault: (point) => {
        if (point === 'before-marker-commit') throw new Error('before marker');
      },
    }, () => ({
      value: 'prepared',
      rollback: () => { beforeRollback += 1; return []; },
    }))).toThrow('before marker');
    expect(beforeRollback).toBe(1);
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(false);

    let afterRollback = 0;
    const committed = transactSquidRepositoryFamilyArm(repo, {
      pdHome,
      fault: (point) => {
        if (point === 'after-marker-commit') throw new Error('after marker');
      },
    }, () => ({
      value: 'committed',
      rollback: () => { afterRollback += 1; return []; },
    }));
    expect(committed.value).toBe('committed');
    expect(committed.arm.commitReadBack).toBe(true);
    expect(afterRollback).toBe(0);
    expect(inspectSquidRepositoryFamily(repo, { pdHome }).armed).toBe(true);
  });

  test('worktree enumeration uses absolute trusted Git and fails closed on timeout, overflow, or incomplete output', () => {
    const main = join(scratch, 'enumeration-main');
    const linked = join(scratch, 'enumeration-linked');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'enumeration-linked', linked);
    const roots = listVerifiedRepositoryFamilyWorktrees(main);
    expect(roots).toEqual([linked, main].sort());

    const fakeBin = join(scratch, 'fake-git-bin');
    const fakeSentinel = join(scratch, 'fake-git-ran');
    mkdirSync(fakeBin);
    writeFileSync(join(fakeBin, 'git'), `#!/bin/sh\nprintf x > '${fakeSentinel}'\nexit 0\n`, { mode: 0o755 });
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${fakeBin}:${originalPath ?? ''}`;
      expect(listVerifiedRepositoryFamilyWorktrees(main)).toEqual(roots);
    } finally {
      process.env.PATH = originalPath;
    }
    expect(existsSync(fakeSentinel)).toBe(false);

    let invocationPath = '';
    expect(listVerifiedRepositoryFamilyWorktrees(main, {
      runGit: (invocation) => {
        invocationPath = invocation.gitPath;
        expect(invocation.env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
        return execFileSync(invocation.gitPath, invocation.args, {
          encoding: 'utf8', timeout: invocation.timeoutMs, maxBuffer: invocation.maxBuffer, env: invocation.env,
        });
      },
    })).toEqual(roots);
    expect(invocationPath.startsWith('/')).toBe(true);

    expect(() => listVerifiedRepositoryFamilyWorktrees(main, {
      runGit: () => { throw new Error('simulated timeout'); },
    })).toThrow(/failed closed/i);
    expect(() => listVerifiedRepositoryFamilyWorktrees(main, {
      runGit: () => `worktree ${main}\n\n${'x'.repeat(1024 * 1024)}`,
    })).toThrow(/oversized/i);
    expect(() => listVerifiedRepositoryFamilyWorktrees(main, {
      runGit: () => `worktree ${main}\n\n`,
    })).toThrow(/incomplete/i);
  });

  test('a stale-looking lock is never reaped by time, and an old owner cannot release a successor lock', () => {
    const first = acquireRepositoryFamilyMutationLock(pdHome);
    const old = new Date(Date.now() - 120_000);
    utimesSync(first.path, old, old);
    expect(() => acquireRepositoryFamilyMutationLock(pdHome)).toThrow(/mutation lock is busy/i);
    first.release();

    const second = acquireRepositoryFamilyMutationLock(pdHome);
    first.release();
    expect(existsSync(second.path)).toBe(true);
    second.release();
    expect(existsSync(second.path)).toBe(false);
  });

  test('lock doctor diagnoses live, dead, PID-reused, malformed, symlinked, and unreadable owners without mutating bytes', () => {
    const makeLock = (name: string) => {
      const home = join(scratch, name);
      mkdirSync(home, { mode: 0o700 });
      const lock = acquireRepositoryFamilyMutationLock(home);
      const stats = lstatSync(lock.path);
      const ownerPath = join(lock.path, 'owner.v1');
      const original = readFileSync(ownerPath, 'utf8');
      const active = inspectRepositoryFamilyMutationLock(home);
      expect(active).toMatchObject({
        exists: true,
        automaticRecoveryAllowed: false,
        manualRecoveryRequired: false,
        reason: 'mutation-lock-owner-live',
      });
      return { home, lock, stats, ownerPath, original, active };
    };

    const live = makeLock('lock-live');
    const old = new Date(Date.now() - 3_600_000);
    utimesSync(live.lock.path, old, old);
    expect(inspectRepositoryFamilyMutationLock(live.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: false,
      reason: 'mutation-lock-owner-live',
      lockDevice: live.stats.dev,
      lockInode: live.stats.ino,
    });
    expect(readFileSync(live.ownerPath, 'utf8')).toBe(live.original);
    expect(live.lock.release()).toBe(true);

    const dead = makeLock('lock-dead');
    writeFileSync(
      dead.ownerPath,
      `v1\t${dead.lock.nonce}\t${dead.stats.dev}\t${dead.stats.ino}\t2147483647\tproc-1\n`,
      { mode: 0o600 },
    );
    const deadBytes = readFileSync(dead.ownerPath, 'utf8');
    expect(inspectRepositoryFamilyMutationLock(dead.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-owner-absent',
      lockDevice: dead.stats.dev,
      lockInode: dead.stats.ino,
    });
    expect(readFileSync(dead.ownerPath, 'utf8')).toBe(deadBytes);
    expect(lstatSync(dead.lock.path).ino).toBe(dead.stats.ino);

    const reused = makeLock('lock-reused');
    const mismatchedToken = reused.active.ownerStartToken === 'proc-1'
      ? `ps-${'0'.repeat(64)}`
      : 'proc-1';
    writeFileSync(
      reused.ownerPath,
      `v1\t${reused.lock.nonce}\t${reused.stats.dev}\t${reused.stats.ino}\t${process.pid}\t${mismatchedToken}\n`,
      { mode: 0o600 },
    );
    const reusedBytes = readFileSync(reused.ownerPath, 'utf8');
    expect(inspectRepositoryFamilyMutationLock(reused.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-owner-pid-reused',
    });
    expect(readFileSync(reused.ownerPath, 'utf8')).toBe(reusedBytes);
    expect(lstatSync(reused.lock.path).ino).toBe(reused.stats.ino);

    const malformed = makeLock('lock-malformed');
    writeFileSync(malformed.ownerPath, 'malformed\n', { mode: 0o600 });
    expect(inspectRepositoryFamilyMutationLock(malformed.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-malformed',
    });
    expect(readFileSync(malformed.ownerPath, 'utf8')).toBe('malformed\n');
    expect(lstatSync(malformed.lock.path).ino).toBe(malformed.stats.ino);

    const symlinked = makeLock('lock-symlinked');
    const outsideOwner = join(scratch, 'outside-lock-owner');
    writeFileSync(outsideOwner, symlinked.original);
    rmSync(symlinked.ownerPath);
    symlinkSync(outsideOwner, symlinked.ownerPath);
    expect(inspectRepositoryFamilyMutationLock(symlinked.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-malformed',
    });
    expect(readFileSync(outsideOwner, 'utf8')).toBe(symlinked.original);
    expect(lstatSync(symlinked.ownerPath).isSymbolicLink()).toBe(true);

    const unreadable = makeLock('lock-unreadable');
    chmodSync(unreadable.ownerPath, 0o000);
    expect(inspectRepositoryFamilyMutationLock(unreadable.home)).toMatchObject({
      automaticRecoveryAllowed: false,
      manualRecoveryRequired: true,
      reason: 'mutation-lock-malformed',
    });
    expect(lstatSync(unreadable.ownerPath).mode & 0o777).toBe(0o000);
    expect(lstatSync(unreadable.lock.path).ino).toBe(unreadable.stats.ino);
    chmodSync(unreadable.ownerPath, 0o600);
    expect(readFileSync(unreadable.ownerPath, 'utf8')).toBe(unreadable.original);
  });

  test('Linux proc start-token parsing survives a parenthesized command name', () => {
    const beforeStart = ['S', ...Array.from({ length: 18 }, (_, index) => String(index + 1))];
    const line = `123 (worker ) with (nested) parens) ${beforeStart.join(' ')} 987654 0 0`;
    expect(parseLinuxProcStatStartToken(line)).toBe('proc-987654');
    expect(parseLinuxProcStatStartToken('123 malformed')).toBeNull();
  });

  test('disarm never follows a repo-controlled symlinked marker parent', () => {
    const repo = join(scratch, 'repo');
    const outside = join(scratch, 'outside');
    initializeRepository(repo);
    const armed = armSquidRepositoryFamily(repo, { pdHome });
    const markerParent = join(repo, '.git', 'port-daddy');
    const originalParent = `${markerParent}.original`;
    mkdirSync(outside);
    renameSync(markerParent, originalParent);
    const outsideMarker = join(outside, repositoryFamilyMarkerPath(armed.authority).split('/').at(-1)!);
    copyFileSync(repositoryFamilyMarkerPath(armed.authority).replace(markerParent, originalParent), outsideMarker);
    const sentinel = join(outside, 'must-survive');
    writeFileSync(sentinel, 'sentinel\n');
    symlinkSync(outside, markerParent);

    expect(disarmSquidRepositoryFamily(repo, { pdHome })).toMatchObject({
      revoked: false,
      reason: 'marker-parent-invalid',
    });
    expect(existsSync(outsideMarker)).toBe(true);
    expect(readFileSync(sentinel, 'utf8')).toBe('sentinel\n');
  });

  test('non-Git authority covers descendants but stops at the nearest nested project boundary or symlink escape', () => {
    const root = join(scratch, 'plain');
    const descendant = join(root, 'src', 'nested');
    const nestedProject = join(root, 'src', 'package');
    const sibling = join(scratch, 'sibling');
    mkdirSync(join(root, '.portdaddy'), { recursive: true });
    mkdirSync(descendant, { recursive: true });
    mkdirSync(join(nestedProject, '.portdaddy'), { recursive: true });
    mkdirSync(join(sibling, '.portdaddy'), { recursive: true });
    symlinkSync(sibling, join(root, 'escaped'));

    armSquidRepositoryFamily(root, { pdHome });

    expect(inspectSquidRepositoryFamily(root, { pdHome })).toMatchObject({ armed: true, kind: 'root' });
    expect(inspectSquidRepositoryFamily(descendant, { pdHome })).toMatchObject({ armed: true, kind: 'root' });
    expect(inspectSquidRepositoryFamily(nestedProject, { pdHome }).armed).toBe(false);
    expect(inspectSquidRepositoryFamily(sibling, { pdHome }).armed).toBe(false);
    expect(inspectSquidRepositoryFamily(join(root, 'escaped'), { pdHome }).armed).toBe(false);
  });

  test('off from any linked worktree revokes the whole repository family', () => {
    const main = join(scratch, 'main');
    const linked = join(scratch, 'linked');
    initializeRepository(main);
    git(main, 'worktree', 'add', '-b', 'linked', linked);
    const armed = armSquidRepositoryFamily(main, { pdHome });

    expect(disarmSquidRepositoryFamily(linked, { pdHome })).toMatchObject({
      revoked: true,
      localRepositoryId: armed.localRepositoryId,
    });
    expect(inspectSquidRepositoryFamily(main, { pdHome }).armed).toBe(false);
    expect(inspectSquidRepositoryFamily(linked, { pdHome }).armed).toBe(false);
    expect(existsSync(repositoryFamilyVerifierPath(armed.authority, pdHome))).toBe(false);
    expect(existsSync(repositoryFamilyDenyPath(resolveRepositoryFamilyAuthority(linked)!, pdHome))).toBe(false);
  });
});
