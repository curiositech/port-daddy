/**
 * Real isolated Git fixtures for pending-merge ownership, not parent pass-through.
 * No daemon or network: Git configuration and commit attribution are synthetic.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_GUARD_CONFIG, evaluateGuardFacts, ownerQueryPaths, stagedFiles } from '../../cli/commands/guard.js';

const scratchDirs = [];
const savedGitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')));
beforeAll(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_OPTIONAL_LOCKS = '0';
  process.env.GIT_CEILING_DIRECTORIES = join(homedir(), 'coding', 'tmp');
});
afterEach(() => {
  while (scratchDirs.length) rmSync(scratchDirs.pop(), { recursive: true });
});
afterAll(() => {
  for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
  Object.assign(process.env, savedGitEnv);
});

function gitResult(args, cwd, input) {
  return spawnSync('git', ['-c', 'user.name=Guard fixture', '-c', 'user.email=guard-fixture@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', timeout: 10_000, input });
}
function git(args, cwd) {
  const result = gitResult(args, cwd);
  if (result.error || result.status !== 0) throw new Error('Fixture Git failed: ' + result.stderr);
  return result.stdout;
}
function freshDirectory(name) {
  const root = join(homedir(), 'coding', 'tmp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'pd-guard-merge-' + name + '-'));
  scratchDirs.push(dir);
  return dir;
}
function freshRepo(name) {
  const dir = freshDirectory(name);
  const template = join(dir, 'empty-template');
  mkdirSync(template);
  git(['init', '-q', '-b', 'trunk', '--template=' + template], dir);
  return dir;
}
function write(dir, path, content) {
  writeFileSync(join(dir, path), content);
  git(['add', '--', path], dir);
}
function commit(dir, message) { git(['commit', '-qm', message], dir); }
function mergePath(dir, name = 'MERGE_HEAD') {
  return resolve(dir, git(['rev-parse', '--git-path', name], dir).trim());
}
function pendingMerge({ conflict = false } = {}) {
  const dir = freshRepo(conflict ? 'conflict' : 'clean');
  write(dir, 'shared.txt', 'base\n');
  write(dir, 'head-deleted.txt', 'delete in HEAD\n');
  write(dir, 'incoming-deleted.txt', 'delete incoming\n');
  commit(dir, 'base');
  git(['switch', '-qc', 'feature'], dir);
  write(dir, 'head-only.txt', 'HEAD contribution\n');
  git(['rm', '-q', '--', 'head-deleted.txt'], dir);
  if (conflict) write(dir, 'shared.txt', 'HEAD version\n');
  commit(dir, 'HEAD contribution');
  git(['switch', '-q', 'trunk'], dir);
  write(dir, 'incoming-only.txt', 'incoming contribution\n');
  git(['rm', '-q', '--', 'incoming-deleted.txt'], dir);
  if (conflict) write(dir, 'shared.txt', 'incoming version\n');
  commit(dir, 'incoming contribution');
  git(['switch', '-q', 'feature'], dir);
  const result = gitResult(['merge', '--no-ff', '--no-commit', 'trunk'], dir);
  expect(result.status).toBe(conflict ? 1 : 0);
  expect(existsSync(mergePath(dir))).toBe(true);
  return dir;
}

describe('stagedFiles — exact all-parent attribution', () => {
  test('a pending clean merge excludes additions and deletions passed through from either parent', () => {
    const dir = pendingMerge();
    const indexBefore = readFileSync(mergePath(dir, 'index'));
    expect(stagedFiles(dir)).toEqual([]);
    expect(readFileSync(mergePath(dir, 'index'))).toEqual(indexBefore);
    expect(existsSync(mergePath(dir))).toBe(true);
  });

  test('a real resolution differs from both parents; unrelated work from both is excluded', () => {
    const dir = pendingMerge({ conflict: true });
    write(dir, 'shared.txt', 'resolved by this merge\n');
    expect(stagedFiles(dir)).toEqual(['shared.txt']);
    commit(dir, 'resolved merge');
    expect(git(['show', '--format=', '--name-only', '--no-renames', '-z', 'HEAD'], dir).split('\0').filter(Boolean))
      .toEqual(['shared.txt']);
  });

  test.each(['HEAD', 'MERGE_HEAD'])('choosing %s unchanged excludes that parent contribution', parent => {
    const dir = pendingMerge({ conflict: true });
    write(dir, 'shared.txt', git(['show', parent + ':shared.txt'], dir));
    expect(stagedFiles(dir)).toEqual([]);
  });

  test('new staged work and a deletion against both parents remain authored', () => {
    const dir = pendingMerge({ conflict: true });
    git(['rm', '-q', '--', 'shared.txt'], dir);
    write(dir, 'resolution.txt', 'new merge result\n');
    expect(stagedFiles(dir).sort()).toEqual(['resolution.txt', 'shared.txt']);
  });

  test('a rename resolution retains its destination and newly deleted source', () => {
    const dir = pendingMerge({ conflict: true });
    write(dir, 'shared.txt', 'resolved before rename\n');
    git(['mv', 'shared.txt', 'resolved-name.txt'], dir);
    git(['config', 'diff.renames', 'copies'], dir);
    expect(stagedFiles(dir).sort()).toEqual(['resolved-name.txt', 'shared.txt']);
  });

  test('an unchanged rename from either parent is pass-through', () => {
    const dir = freshRepo('parent-renames');
    write(dir, 'left.txt', 'left\n');
    write(dir, 'right.txt', 'right\n');
    commit(dir, 'base');
    git(['switch', '-qc', 'feature'], dir);
    git(['mv', 'left.txt', 'left-renamed.txt'], dir);
    commit(dir, 'left rename');
    git(['switch', '-q', 'trunk'], dir);
    git(['mv', 'right.txt', 'right-renamed.txt'], dir);
    commit(dir, 'right rename');
    git(['switch', '-q', 'feature'], dir);
    git(['merge', '--no-ff', '--no-commit', 'trunk'], dir);
    expect(stagedFiles(dir)).toEqual([]);
  });

  test('mode, symlink and binary changes against both parents are retained', () => {
    const dir = pendingMerge();
    chmodSync(join(dir, 'shared.txt'), 0o755);
    git(['add', '--', 'shared.txt'], dir);
    symlinkSync('shared.txt', join(dir, 'link'));
    git(['add', '--', 'link'], dir);
    write(dir, 'binary.bin', Buffer.from([0, 1, 2, 255]));
    expect(stagedFiles(dir).sort()).toEqual(['binary.bin', 'link', 'shared.txt']);
  });

  test('linked worktrees resolve their own merge metadata, preserving the parent index', () => {
    const repo = pendingMerge({ conflict: true });
    const indexBefore = readFileSync(mergePath(repo, 'index'));
    const linked = join(freshDirectory('linked-parent'), 'checkout');
    git(['worktree', 'add', '-q', '-b', 'linked-feature', linked, 'HEAD'], repo);
    expect(gitResult(['merge', '--no-ff', '--no-commit', 'trunk'], linked).status).toBe(1);
    write(linked, 'shared.txt', 'linked resolution\n');
    expect(stagedFiles(linked)).toEqual(['shared.txt']);
    expect(readFileSync(mergePath(repo, 'index'))).toEqual(indexBefore);
  });

  test('every incoming octopus parent counts, not only the first MERGE_HEAD line', () => {
    const dir = freshRepo('octopus');
    write(dir, 'base.txt', 'base\n');
    commit(dir, 'base');
    git(['switch', '-qc', 'left'], dir);
    write(dir, 'left.txt', 'left\n');
    commit(dir, 'left');
    git(['switch', '-qc', 'right', 'trunk'], dir);
    write(dir, 'right.txt', 'right\n');
    commit(dir, 'right');
    git(['switch', '-q', 'trunk'], dir);
    git(['merge', '--no-ff', '--no-commit', 'left', 'right'], dir);
    expect(readFileSync(mergePath(dir), 'utf8').trim().split('\n')).toHaveLength(2);
    expect(stagedFiles(dir)).toEqual([]);
    write(dir, 'authored.txt', 'new\n');
    expect(stagedFiles(dir)).toEqual(['authored.txt']);
  });

  test('ordinary and unborn commits retain additions, edits, renames and deletions', () => {
    const dir = freshRepo('plain');
    write(dir, 'edited.txt', 'base\n');
    write(dir, 'deleted.txt', 'delete\n');
    write(dir, 'renamed.txt', 'rename\n');
    expect(stagedFiles(dir).sort()).toEqual(['deleted.txt', 'edited.txt', 'renamed.txt']);
    commit(dir, 'base');
    write(dir, 'edited.txt', 'edit\n');
    write(dir, 'added.txt', 'new\n');
    git(['rm', '-q', '--', 'deleted.txt'], dir);
    git(['mv', 'renamed.txt', 'new-name.txt'], dir);
    expect(stagedFiles(dir).sort()).toEqual(['added.txt', 'deleted.txt', 'edited.txt', 'new-name.txt']);
  });

  test.each([false, true])('NUL paths stay exact through discovery and queries (merge=%s)', merging => {
    const dir = merging ? pendingMerge() : freshRepo('unusual-paths');
    const names = [' leading.txt', 'trailing.txt ', '   ', 'tab\tname.txt', 'line\nname.txt',
      'quote"name.txt', 'back\\slash.txt', '-option.txt', '海.txt', 'replacement-\uFFFD.txt'];
    for (const name of names) write(dir, name, 'authored\n');
    expect(stagedFiles(dir).sort()).toEqual([...names].sort());
    for (const name of names) expect(ownerQueryPaths(name, dir)).toEqual([name, resolve(dir, name)]);
  });

  test('a trimmed sibling claim cannot authorize a whitespace-distinct staged file', () => {
    const dir = pendingMerge();
    write(dir, ' private.txt ', 'new\n');
    const facts = evaluateGuardFacts({ config: { ...DEFAULT_GUARD_CONFIG, enabled: true, mode: 'enforce' },
      active: true, agentId: 'own-agent', sessionId: 'own-session', files: stagedFiles(dir),
      ownersByFile: { 'private.txt': [{ agentId: 'own-agent', sessionId: 'own-session' }] } });
    expect(facts.files).toEqual([' private.txt ']);
    expect(facts.shouldBlock).toBe(true);
    expect(facts.violations).toEqual([expect.objectContaining({ code: 'unclaimed-file', file: ' private.txt ' })]);
  });

  test('undecodable native path bytes fail instead of aliasing a valid replacement character', () => {
    const dir = freshRepo('non-utf8');
    // APFS refuses such a filename on disk; Git can still receive it in an index.
    const blob = gitResult(['hash-object', '-w', '--stdin'], dir, 'authored\n');
    expect(blob.status).toBe(0);
    const entry = Buffer.concat([Buffer.from('100644 ' + blob.stdout.trim() + '\t'), Buffer.from([0xff, 0])]);
    expect(gitResult(['update-index', '-z', '--index-info'], dir, entry).status).toBe(0);
    expect(() => stagedFiles(dir)).toThrow('unsupported path encoding');
  });

  test('unresolved index stages fail instead of disappearing from the intersection', () => {
    expect(() => stagedFiles(pendingMerge({ conflict: true }))).toThrow('index contains unresolved merges');
  });

  test.each(['', 'not-a-ref\n', 'f'.repeat(40) + '\n', '--output=/private/fixture-secret\n'])
    ('unknown or malformed merge evidence fails closed (%j)', content => {
      const dir = pendingMerge();
      writeFileSync(mergePath(dir), content);
      expect(() => stagedFiles(dir)).toThrow('Guard cannot determine staged files');
      try { stagedFiles(dir); } catch (error) { expect(error.message).not.toContain('fixture-secret'); }
    });

  test('unreadable merge metadata does not fall back to ordinary HEAD semantics', () => {
    const dir = pendingMerge();
    const path = mergePath(dir);
    renameSync(path, path + '.saved');
    mkdirSync(path);
    expect(() => stagedFiles(dir)).toThrow('merge metadata is unreadable');
  });

  test('corrupt indexes and invalid repository boundaries are unavailable evidence, not empty work', () => {
    const dir = freshRepo('corrupt');
    writeFileSync(mergePath(dir, 'index'), 'not a Git index');
    expect(() => stagedFiles(dir)).toThrow('Git evidence is unavailable');
    const invalid = freshDirectory('not-a-repo');
    // An ancestor may itself be a checkout; explicitly stop parent discovery.
    writeFileSync(join(invalid, '.git'), 'invalid fixture repository boundary\n');
    expect(() => stagedFiles(invalid)).toThrow('Git evidence is unavailable');
    expect(() => stagedFiles(join(invalid, 'missing'))).toThrow('Git evidence is unavailable');
  });
});
