import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { createGitOriginChecker } from '../../lib/git-origin-check.js';

let root;
let work;
let origin;
const env = { ...process.env };
const realGit = realpathSync(process.env.PATH.split(delimiter).map(p => join(p, 'git')).find(existsSync));
for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
Object.assign(env, {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Origin proof fixture', GIT_COMMITTER_NAME: 'Origin proof fixture',
  GIT_AUTHOR_EMAIL: 'fixture@portdaddy.invalid', GIT_COMMITTER_EMAIL: 'fixture@portdaddy.invalid',
});
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(name = 'change') {
  writeFileSync(join(work, `${name}.txt`), `${name}\n`);
  git(work, 'add', `${name}.txt`);
  git(work, 'commit', '-m', name);
  return git(work, 'rev-parse', 'HEAD');
}
function snapshot() {
  return {
    config: readFileSync(resolve(work, git(work, 'rev-parse', '--git-common-dir'), 'config'), 'utf8'),
    index: readFileSync(resolve(work, git(work, 'rev-parse', '--git-path', 'index'))).toString('base64'),
    refs: git(work, 'show-ref'),
    status: git(work, 'status', '--porcelain=v1', '--untracked-files=all'),
  };
}
function check() {
  const before = snapshot();
  const result = createGitOriginChecker().checkBranchOnOrigin(work);
  expect(snapshot()).toEqual(before);
  return result;
}
// An owned transparent Git wrapper intercepts only the advertised read. Git
// repositories, commits and ancestry remain real; injected races are explicit
// fixture writes outside the production checker, never provider traffic.
function withFault(mode, action) {
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'package.json'), '{"type":"commonjs"}\n');
  const wrapper = join(bin, 'git');
  writeFileSync(wrapper, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const realGit = ${JSON.stringify(realGit)};
const root = ${JSON.stringify(root)};
const work = ${JSON.stringify(work)};
const origin = ${JSON.stringify(origin)};
const mode = ${JSON.stringify(mode)};
const child = {...process.env};
const execute = (cwd, argv) => cp.execFileSync(realGit, argv, {cwd, env:child, encoding:'utf8', stdio:['ignore','pipe','pipe']});
if (args.includes('ls-remote')) {
  const countPath = root + '/reads';
  const count = fs.existsSync(countPath) ? Number(fs.readFileSync(countPath,'utf8')) + 1 : 1;
  fs.writeFileSync(countPath,String(count));
  const policyKeys = ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_CONFIG_COUNT',
    'GIT_TRACE','GIT_TRACE2_EVENT','GIT_TERMINAL_PROMPT','SSH_ASKPASS_REQUIRE',
    'GIT_OPTIONAL_LOCKS','GIT_NO_REPLACE_OBJECTS','GIT_NO_LAZY_FETCH','GIT_SSH_COMMAND'];
  fs.writeFileSync(root + '/query-env.json',JSON.stringify(Object.fromEntries(
    policyKeys.filter(key => process.env[key] !== undefined).map(key => [key,process.env[key]]))));
  if (mode === 'timeout') { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000); }
  if (mode === 'oversized') { process.stdout.write('x'.repeat(70000)); process.exit(0); }
  if (mode === 'failure') { process.stderr.write('https://synthetic:secret@invalid.example/private'); process.exit(128); }
  if (count === 2 && mode === 'remote-race') execute(origin,['update-ref','refs/heads/trunk',execute(work,['rev-parse','HEAD^']).trim()]);
  if (count === 2 && mode === 'dirty-race') fs.writeFileSync(work+'/untracked.txt','late work');
  if (count === 2 && mode === 'head-race') execute(work,['update-ref','refs/heads/feature',execute(work,['rev-parse','HEAD^']).trim()]);
  if (count === 2 && mode === 'origin-race') execute(work,['remote','set-url','origin',root+'/missing.git']);
  let output = execute(process.cwd(),args);
  if (mode === 'duplicate') output += output;
  if (mode === 'malformed') output = 'ref: refs/tags/not-a-default\\tHEAD\\n' + 'a'.repeat(40) + '\\tHEAD\\n';
  if (mode === 'unknown-ref') output += 'a'.repeat(40) + '\\trefs/heads/extra\\n';
  if (mode === 'object-missing') output = output.replace(/[0-9a-f]{40}(?=\\tHEAD)/g,'f'.repeat(40));
  if (mode === 'contradictory-head' || mode === 'contradictory-head-reordered') output = output.replace(/^[0-9a-f]{40}\\tHEAD$/m,execute(work,['rev-parse','HEAD']).trim()+'\\tHEAD');
  if (mode === 'contradictory-default-row') output = output.replace(/^[0-9a-f]{40}\\trefs\\/heads\\/trunk$/m,execute(work,['rev-parse','HEAD^']).trim()+'\\trefs/heads/trunk');
  if (mode === 'reverse-order' || mode === 'contradictory-head-reordered') output = output.trim().split('\\n').reverse().join('\\n')+'\\n';
  process.stdout.write(output); process.exit(0);
}
process.stdout.write(execute(process.cwd(),args));
`);
  chmodSync(wrapper, 0o700);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${previous}`;
  try { return action(); } finally { process.env.PATH = previous; }
}
beforeEach(() => {
  const scratch = join(process.cwd(), '.scratch');
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(join(scratch, 'origin-delivery-'));
  origin = join(root, 'origin.git');
  work = join(root, 'work');
  git(root, 'init', '--bare', '-b', 'trunk', origin);
  git(root, 'init', '-b', 'trunk', work);
  git(work, 'remote', 'add', 'origin', origin);
  commit('baseline');
  git(work, 'push', '-u', 'origin', 'trunk');
  git(work, 'switch', '-c', 'feature');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('ordinary completion origin delivery evidence', () => {
  test('accepts a clean exact origin upstream', () => {
    const head = commit();
    git(work, 'push', '-u', 'origin', 'feature');
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-upstream', head, ref: 'refs/heads/feature', oid: head } });
  });
  test('accepts the normal origin upstream when the server has no default HEAD', () => {
    git(work, 'push', '-u', 'origin', 'feature');
    git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/missing');
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-upstream', ref: 'refs/heads/feature' } });
  });
  test('uses an exact linked worktree rather than its main checkout', () => {
    const linked = join(root, 'linked');
    git(work, 'worktree', 'add', '-b', 'linked-feature', linked, 'feature');
    writeFileSync(join(work, 'main-unfinished.txt'), 'unrelated main work');
    work = linked;
    expect(check()).toMatchObject({ ok: true, branch: 'linked-feature', proof: { kind: 'origin-default-ancestry' } });
  });
  test('rejects detached HEAD and absence of a repository', () => {
    git(work, 'switch', '--detach');
    expect(check().ok).toBe(false);
    expect(createGitOriginChecker().checkBranchOnOrigin(join(root, 'absent'))).toMatchObject({ ok: false, code: 'NO_REPO' });
  });
  test('accepts already merged work with no branch tracking metadata', () => {
    const head = commit();
    git(work, 'push', 'origin', 'HEAD:refs/heads/trunk');
    expect(check()).toMatchObject({ ok: true, upstream: null, proof: { kind: 'origin-default-ancestry', head, ref: 'refs/heads/trunk', oid: head } });
  });
  test('ignores legitimate HEAD-tail branches and annotated tags when proving the exact default', () => {
    const head = git(work, 'rev-parse', 'HEAD');
    git(origin, 'update-ref', 'refs/heads/topic/HEAD', head);
    git(work, 'tag', '-a', 'archive/HEAD', '-m', 'synthetic annotated tail');
    git(work, 'push', 'origin', 'refs/tags/archive/HEAD');
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-default-ancestry', ref: 'refs/heads/trunk', oid: head } });
  });
  test('does not use a legitimate HEAD-tail branch as proof for unpublished work', () => {
    commit('unpublished');
    git(work, 'push', 'origin', 'HEAD:refs/heads/topic/HEAD');
    expect(check()).toMatchObject({ ok: false, code: 'NO_UPSTREAM' });
  });
  test('checks a default branch ending in HEAD consistently regardless of row order', () => {
    const head = git(work, 'rev-parse', 'HEAD');
    git(origin, 'update-ref', 'refs/heads/project/HEAD', head);
    git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/project/HEAD');
    const expected = { ok: true, proof: { kind: 'origin-default-ancestry', ref: 'refs/heads/project/HEAD', oid: head } };
    expect(check()).toMatchObject(expected);
    withFault('reverse-order', () => expect(check()).toMatchObject(expected));
  });
  test('ignores a longer tail match of a fully qualified upstream ref', () => {
    const head = commit('published');
    git(work, 'push', '-u', 'origin', 'feature');
    git(origin, 'update-ref', 'refs/heads/archive/refs/heads/feature', git(work, 'rev-parse', 'HEAD^'));
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-upstream', ref: 'refs/heads/feature', oid: head } });
  });
  test.each(['contradictory-head', 'contradictory-head-reordered'])('rejects %s instead of rescuing unpublished HEAD', mode => {
    commit('unpublished');
    git(work, 'branch', '--set-upstream-to=origin/trunk', 'feature');
    expect(check().ok).toBe(false);
    withFault(mode, () => expect(check()).toMatchObject({ ok: false, code: 'GIT_ERROR' }));
  });
  test('rejects a contradictory default row even when HEAD ancestry would otherwise pass', () => {
    commit('published');
    git(work, 'push', 'origin', 'HEAD:refs/heads/trunk');
    git(work, 'branch', '--set-upstream-to=origin/trunk', 'feature');
    expect(check().ok).toBe(true);
    withFault('contradictory-default-row', () => expect(check()).toMatchObject({ ok: false, code: 'GIT_ERROR' }));
  });
  test('accepts merged work after the configured upstream is deleted and pruned', () => {
    const head = commit();
    git(work, 'push', '-u', 'origin', 'feature');
    git(work, 'push', 'origin', 'HEAD:refs/heads/trunk');
    git(work, 'push', 'origin', '--delete', 'feature');
    git(work, 'fetch', '--prune', 'origin');
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-default-ancestry', head, ref: 'refs/heads/trunk', oid: head } });
  });
  test('accepts a notes-only clean branch already contained in the advertised non-main default', () => {
    expect(check()).toMatchObject({ ok: true, proof: { kind: 'origin-default-ancestry', ref: 'refs/heads/trunk' } });
  });
  test('rejects unique unpublished work without pretending it was never pushed', () => {
    commit('unpublished');
    const result = check();
    expect(result.ok).toBe(false);
    expect(result.error).not.toMatch(/nothing has been pushed/i);
  });
  test.each(['tracked', 'untracked', 'staged'])('rejects %s changes in the canonical fallback', kind => {
    writeFileSync(join(work, kind === 'untracked' ? 'new.txt' : 'baseline.txt'), 'unfinished\n');
    if (kind === 'staged') git(work, 'add', 'baseline.txt');
    expect(check()).toMatchObject({ ok: false, code: 'DIRTY_WORKTREE' });
  });
  test.each(['tracked', 'untracked', 'staged'])('rejects %s changes even with a fully published normal upstream', kind => {
    git(work, 'push', '-u', 'origin', 'feature');
    writeFileSync(join(work, kind === 'untracked' ? 'new.txt' : 'baseline.txt'), 'unfinished\n');
    if (kind === 'staged') git(work, 'add', 'baseline.txt');
    expect(check()).toMatchObject({ ok: false, code: 'DIRTY_WORKTREE' });
  });
  test('preserves ignored local evidence without treating it as unfinished source', () => {
    writeFileSync(join(work, '.git/info/exclude'), 'evidence/\n');
    mkdirSync(join(work, 'evidence'));
    writeFileSync(join(work, 'evidence/receipt.txt'), 'retained\n');
    expect(check().ok).toBe(true);
    expect(readFileSync(join(work, 'evidence/receipt.txt'), 'utf8')).toBe('retained\n');
  });
  test('rejects a commit published only to another remote', () => {
    const other = join(root, 'other.git');
    git(root, 'init', '--bare', '-b', 'trunk', other);
    git(work, 'remote', 'add', 'other', other);
    commit('other-only');
    git(work, 'push', '-u', 'other', 'feature');
    expect(check().ok).toBe(false);
  });
  test('does not trust stale local origin/HEAD after the advertised default changes', () => {
    git(work, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/missing');
    expect(check().ok).toBe(false);
  });
  test('does not mistake a directory named origin for a configured remote', () => {
    git(work, 'remote', 'remove', 'origin');
    mkdirSync(join(work, 'origin'));
    expect(check().ok).toBe(false);
  });
  test('rejects stale local tracking ref after remote branch was removed without merging', () => {
    commit('not-merged');
    git(work, 'push', '-u', 'origin', 'feature');
    git(origin, 'update-ref', '-d', 'refs/heads/feature');
    expect(check().ok).toBe(false);
  });
  test('accepts ancestry in a genuine merge commit without requiring feature-ref survival', () => {
    const head = commit('feature-change');
    git(work, 'switch', 'trunk');
    commit('trunk-change');
    git(work, 'merge', '--no-ff', 'feature', '-m', 'merged feature');
    const merged = git(work, 'rev-parse', 'HEAD');
    git(work, 'push', 'origin', 'trunk');
    git(work, 'switch', 'feature');
    expect(check()).toMatchObject({ ok: true, proof: { head, oid: merged, kind: 'origin-default-ancestry' } });
  });
  test('refuses unproven squash delivery despite equivalent files', () => {
    commit('one'); commit('two');
    git(work, 'switch', 'trunk');
    git(work, 'merge', '--squash', 'feature');
    git(work, 'commit', '-m', 'squashed');
    git(work, 'push', 'origin', 'trunk');
    git(work, 'switch', 'feature');
    expect(git(work, 'diff', 'origin/trunk', 'HEAD')).toBe('');
    expect(check().ok).toBe(false);
  });
  test.each(['replacement', 'graft'])('does not accept forged ancestry through a local %s', kind => {
    const unpublished = commit('unpublished');
    const published = git(work, 'rev-parse', 'origin/trunk');
    if (kind === 'replacement') {
      git(work, 'replace', '--graft', published, unpublished);
    } else {
      writeFileSync(join(work, '.git/info/grafts'), `${published} ${unpublished}\n`);
    }
    // Demonstrate the unprotected local view is actually forged, not a vacuous
    // negative. Production must read the original graph instead.
    expect(git(work, 'merge-base', '--is-ancestor', unpublished, published)).toBe('');
    expect(check().ok).toBe(false);
  });
  test('supports SHA-256 repositories without guessing a SHA-1 object width', () => {
    origin = join(root, 'sha256-origin.git');
    work = join(root, 'sha256-work');
    git(root, 'init', '--bare', '--object-format=sha256', '-b', 'trunk', origin);
    git(root, 'init', '--object-format=sha256', '-b', 'feature', work);
    git(work, 'remote', 'add', 'origin', origin);
    const head = commit('sha256');
    git(work, 'push', 'origin', 'HEAD:refs/heads/trunk');
    expect(head).toHaveLength(64);
    expect(check()).toMatchObject({ ok: true, proof: { head, oid: head, kind: 'origin-default-ancestry' } });
  });
  test('does not fetch a fresh advertised commit that is not available locally', () => {
    const other = join(root, 'other-work');
    git(root, 'clone', origin, other);
    writeFileSync(join(other, 'new.txt'), 'new remote work\n');
    git(other, 'add', 'new.txt'); git(other, 'commit', '-m', 'remote advanced'); git(other, 'push', 'origin', 'trunk');
    const remoteHead = git(other, 'rev-parse', 'HEAD');
    expect(check()).toMatchObject({ ok: false, code: 'GIT_ERROR' });
    expect(() => git(work, 'cat-file', '-t', remoteHead)).toThrow();
  });
  test('refuses ambiguous multi-URL origin', () => {
    git(work, 'config', '--add', 'remote.origin.url', join(root, 'second.git'));
    expect(check().ok).toBe(false);
  });
  test.each(['duplicate', 'malformed', 'unknown-ref', 'object-missing', 'oversized', 'failure'])('refuses %s advertisements without repository mutation or secret diagnostics', mode => {
    const result = withFault(mode, check);
    expect(result).toMatchObject({ ok: false, code: 'GIT_ERROR' });
    expect(JSON.stringify(result)).not.toMatch(/synthetic:secret|invalid.example|private/);
  });
  test.each(['remote-race', 'dirty-race', 'head-race', 'origin-race'])('refuses %s during the final observation', mode => {
    commit(); git(work, 'push', 'origin', 'HEAD:refs/heads/trunk');
    const result = withFault(mode, () => createGitOriginChecker().checkBranchOnOrigin(work));
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, 'reads'), 'utf8')).toBe('2');
  });
  test('bounds an unresponsive advertised read with one total deadline', () => {
    const start = performance.now();
    const result = withFault('timeout', check);
    expect(result.ok).toBe(false);
    expect(performance.now() - start).toBeLessThan(13000);
    expect(readFileSync(join(root, 'reads'), 'utf8')).toBe('1');
  }, 20000);
  test('ignores inherited Git selectors and traces, and disables interactive query prompts', () => {
    const old = { ...process.env };
    Object.assign(process.env, { GIT_DIR: origin, GIT_WORK_TREE: root, GIT_COMMON_DIR: origin,
      GIT_TRACE: join(root, 'trace'), GIT_TRACE2_EVENT: join(root, 'trace2'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'remote.origin.url', GIT_CONFIG_VALUE_0: 'missing',
      SSH_ASKPASS: 'synthetic-unwanted-command', SSH_ASKPASS_REQUIRE: 'force' });
    try {
      expect(withFault('none', () => createGitOriginChecker().checkBranchOnOrigin(work)).ok).toBe(true);
      const query = JSON.parse(readFileSync(join(root, 'query-env.json'), 'utf8'));
      for (const name of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_CONFIG_COUNT','GIT_TRACE','GIT_TRACE2_EVENT']) expect(query[name]).toBeUndefined();
      expect(query).toMatchObject({ GIT_TERMINAL_PROMPT: '0', SSH_ASKPASS_REQUIRE: 'never', GIT_OPTIONAL_LOCKS: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1' });
      expect(query.GIT_SSH_COMMAND).toMatch(/BatchMode=yes/);
      expect(existsSync(join(root, 'trace'))).toBe(false);
      expect(existsSync(join(root, 'trace2'))).toBe(false);
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
      Object.assign(process.env, old);
    }
  });
});
