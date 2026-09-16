import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { runtimeSkillTargets, syncAgentSkills } from '../../lib/skill-sync.js';
import { skillSyncGitPolicy, skillSyncRepositoryRoot } from '../../lib/skill-sync-git.js';

let fixture;
let gitEnv;
const gitBin = process.platform === 'win32' ? 'git' : '/usr/bin/git';

beforeEach(() => {
  const parent = join(homedir(), 'coding', 'tmp');
  mkdirSync(parent, { recursive: true });
  fixture = mkdtempSync(join(parent, 'pd-sparse-skill-sync-test-'));
  gitEnv = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(fixture, 'empty-git-config'),
    GIT_AUTHOR_NAME: 'Synthetic skill-sync test', GIT_AUTHOR_EMAIL: 'fixture@portdaddy.invalid',
    GIT_COMMITTER_NAME: 'Synthetic skill-sync test', GIT_COMMITTER_EMAIL: 'fixture@portdaddy.invalid' };
  writeFileSync(gitEnv.GIT_CONFIG_GLOBAL, '');
  mkdirSync(join(fixture, 'empty-hooks'));
});

afterEach(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync(gitBin, ['-c', `core.hooksPath=${join(fixture, 'empty-hooks')}`, ...args], {
    cwd, env: gitEnv, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function put(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sparseFixture(scope = 'project') {
  const main = join(fixture, 'main');
  mkdirSync(main);
  git(main, 'init', '--quiet');
  put(join(main, 'keep', 'README.md'), 'Included work.\n');
  for (const target of runtimeSkillTargets(main, scope)) {
    put(join(target.path, 'alpha', 'SKILL.md'), `Handwritten ${target.label} mirror.\n`);
  }
  git(main, 'add', '.');
  git(main, 'commit', '--quiet', '-m', 'Synthetic tracked mirrors');
  put(join(main, '.gitignore'), '**/alpha\n**/beta\n');
  git(main, 'add', '.gitignore');
  git(main, 'commit', '--quiet', '-m', 'Ignore generated links, not tracked files');
  const worktree = join(fixture, 'linked');
  git(main, 'worktree', 'add', '--quiet', '--detach', '--no-checkout', worktree, 'HEAD');
  git(worktree, 'sparse-checkout', 'set', '--cone', 'keep');
  git(worktree, 'checkout', '--quiet', '--detach');
  const source = join(fixture, 'catalog');
  put(join(source, 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Synthetic source\n---\nCanonical alpha.\n');
  return { main, worktree, source, scope };
}

function sync(f, extra = {}) {
  return syncAgentSkills({ baseDir: f.worktree, projectRoot: f.worktree, scope: f.scope,
    sourceRoots: [{ label: 'owned-fixture', path: f.source }], ...extra });
}

function witness(f) {
  const status = git(f.worktree, 'status', '--porcelain', '-z');
  return { head: git(f.worktree, 'rev-parse', 'HEAD'), index: git(f.worktree, 'ls-files', '--stage', '-z'),
    status, indexBytes: readFileSync(git(f.worktree, 'rev-parse', '--git-path', 'index').trim()).toString('base64'),
    sparse: git(f.worktree, 'sparse-checkout', 'list'),
    refs: git(f.worktree, 'show-ref') };
}

function betaOnly(f) {
  f.source = join(fixture, 'beta-catalog');
  put(join(f.source, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Synthetic beta\n---\n');
  return join(f.worktree, '.codex', 'skills');
}

function withEnv(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

// The wrapper executes only fixture-owned code and forwards ordinary reads to
// an absolute system Git. It never starts a login shell or reads a user catalog.
function withGitFault(code, run) {
  const bin = join(fixture, 'fault-bin');
  mkdirSync(bin);
  const wrapper = join(bin, 'git');
  put(wrapper, `#!${process.execPath}\nconst { spawnSync } = require('node:child_process');\nconst args = process.argv.slice(2);\n${code}\nconst result = spawnSync(${JSON.stringify(gitBin)}, args, { env: process.env, stdio: 'inherit' });\nprocess.exit(result.status ?? 1);\n`);
  chmodSync(wrapper, 0o755);
  return withEnv({ PATH: `${bin}:${process.env.PATH}` }, run);
}

function runWrapper(cwd, args = [], policyErrors = []) {
  const { transpileModule, ModuleKind, ScriptTarget } = createRequire(import.meta.url)('typescript');
  const source = readFileSync(new URL('../../scripts/sync-skills.ts', import.meta.url), 'utf8');
  const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const calls = [];
  let stdout = '', stderr = '', exit;
  try {
    runInNewContext(compiled.outputText, {
      exports: {},
      require(id) {
        if (id === 'node:path') return { resolve: createRequire(import.meta.url)('node:path').resolve };
        if (id === '../lib/skill-sync-git.js') return { skillSyncRepositoryRoot };
        if (id === '../lib/skill-sync.js') return {
          // Deliberately stop at the catalog boundary: actual wrapper/root code,
          // actual fixture Git, but never the host's discovered skill sources.
          syncAgentSkills(options) {
            calls.push(options);
            return { created: 0, replaced: 0, errors: policyErrors,
              audit: { missingLinks: 0, staleSymlinks: 0 } };
          },
          formatSkillSyncSummary: () => ['safe policy error'],
        };
        throw Error(`Unexpected wrapper import ${id}`);
      },
      process: {
        argv: ['node', 'sync-skills.ts', ...args], cwd: () => cwd, env: {},
        stdout: { write: (text) => { stdout += text; } },
        stderr: { write: (text) => { stderr += text; } },
        exit(code) { exit = code; throw Error('fixture-exit'); },
      },
    });
  } catch (error) { if (error.message !== 'fixture-exit') throw error; }
  return { calls, stdout, stderr, exit };
}

describe('Git-preserving runtime skill links', () => {
  test.each(['project', 'user'])('preserves every sparse-excluded tracked %s runtime mirror', (scope) => {
    const f = sparseFixture(scope);
    const before = witness(f);
    expect(before.status).toBe('');
    const result = sync(f);
    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.skippedExisting).toHaveLength(runtimeSkillTargets(f.worktree, scope).length);
    for (const target of runtimeSkillTargets(f.worktree, scope)) {
      expect(existsSync(join(target.path, 'alpha'))).toBe(false);
      const tracked = relative(f.worktree, join(target.path, 'alpha', 'SKILL.md'));
      expect(git(f.worktree, 'show', `HEAD:${tracked}`)).toBe(`Handwritten ${target.label} mirror.\n`);
    }
    expect(witness(f)).toEqual(before);
    expect(sync(f).created).toBe(0);
    expect(witness(f)).toEqual(before);
  });

  test('does not populate an untracked skill outside the selected sparse cone', () => {
    const f = sparseFixture();
    put(join(f.source, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: New synthetic skill\n---\n');
    const before = witness(f);
    expect(sync(f).created).toBe(0);
    for (const target of runtimeSkillTargets(f.worktree, f.scope)) expect(existsSync(join(target.path, 'beta'))).toBe(false);
    expect(witness(f)).toEqual(before);
  });

  test('does not expose a non-cone excluded descendant through a directory link', () => {
    const f = sparseFixture();
    betaOnly(f);
    put(join(f.source, 'beta', 'references', 'private.md'), 'Excluded synthetic reference.\n');
    git(f.worktree, 'sparse-checkout', 'set', '--no-cone', '/keep/', '/.codex/skills/', '!/.codex/skills/beta/references/');
    const before = witness(f);
    const result = sync(f);
    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(existsSync(join(f.worktree, '.codex', 'skills', 'beta'))).toBe(false);
    expect(witness(f)).toEqual(before);
  });

  test('preserves included tracked handwritten bytes while allowing an included untracked skill', () => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    put(join(f.source, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: New synthetic skill\n---\n');
    const tracked = join(f.worktree, '.codex', 'skills', 'alpha', 'SKILL.md');
    put(tracked, 'Uncommitted handwritten operator text.\n');
    const before = witness(f);
    const result = sync(f);
    expect(result.errors).toEqual([]);
    expect(result.created).toBe(1);
    expect(readFileSync(tracked, 'utf8')).toBe('Uncommitted handwritten operator text.\n');
    expect(lstatSync(join(f.worktree, '.codex', 'skills', 'beta')).isSymbolicLink()).toBe(true);
    expect(witness(f)).toEqual(before);
  });

  test('preserves tracked symlinks and their descendants without following the link', () => {
    const f = sparseFixture();
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    const target = join(f.main, 'links', 'beta');
    mkdirSync(dirname(target));
    symlinkSync(outside, target);
    git(f.main, 'add', '--force', 'links/beta');
    git(f.main, 'commit', '--quiet', '-m', 'Tracked synthetic link');
    git(f.worktree, 'checkout', '--quiet', '--detach', git(f.main, 'rev-parse', 'HEAD').trim());
    git(f.worktree, 'sparse-checkout', 'add', 'links');
    betaOnly(f);
    const before = witness(f);
    const targetInWorktree = join(f.worktree, 'links', 'beta');
    const result = sync(f, { targets: [{ label: 'tracked link', path: dirname(targetInWorktree) }] });
    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(readlinkSync(targetInWorktree)).toBe(outside);
    const beneath = sync(f, { targets: [{ label: 'beneath tracked link', path: join(targetInWorktree, 'nested') }] });
    expect(beneath.created).toBe(0);
    expect(beneath.errors[0].error).toMatch(/symlink ancestor/);
    expect(readdirSync(outside)).toEqual([]);
    expect(witness(f)).toEqual(before);
  });

  test('preserves an absent sparse-tracked ancestor, not only exact tracked targets', () => {
    const f = sparseFixture();
    betaOnly(f);
    const file = join(f.main, 'excluded-file');
    put(file, 'Tracked ancestor bytes.\n');
    git(f.main, 'add', 'excluded-file');
    git(f.main, 'commit', '--quiet', '-m', 'Tracked ancestor');
    git(f.worktree, 'checkout', '--quiet', '--detach', git(f.main, 'rev-parse', 'HEAD').trim());
    const before = witness(f);
    const target = join(f.worktree, 'excluded-file', 'children', 'beta');
    const policy = skillSyncGitPolicy(f.worktree, [target]);
    expect(policy.preserved.has(target)).toBe(true);
    expect(sync(f, { targets: [{ label: 'tracked ancestor', path: dirname(target) }] }).created).toBe(0);
    expect(readFileSync(join(f.worktree, 'excluded-file'), 'utf8')).toBe('Tracked ancestor bytes.\n');
    expect(witness(f)).toEqual(before);
  });

  test.each(['dryRun', 'statusOnly'])('%s reports preserved mirrors without false missing-link drift or writes', (mode) => {
    const f = sparseFixture();
    const before = witness(f);
    const result = sync(f, { [mode]: true });
    expect(result.created).toBe(0);
    expect(result.audit.expectedLinks).toBe(0);
    expect(result.audit.missingLinks).toBe(0);
    expect(result.skippedExisting).toHaveLength(16);
    expect(witness(f)).toEqual(before);
    for (const target of runtimeSkillTargets(f.worktree, 'project')) expect(existsSync(target.path)).toBe(false);
  });

  test.each(['file', 'symlink', 'parent'])('preserves a %s that appears after policy inspection', (kind) => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    const root = betaOnly(f);
    const target = join(root, 'beta');
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    let reads = 0;
    const changingTarget = { label: 'racing target', get path() {
      if (++reads === 3) {
        if (kind === 'file') put(target, 'Another invocation owns these bytes.\n');
        if (kind === 'symlink') symlinkSync(outside, target);
        if (kind === 'parent') symlinkSync(outside, join(root, 'new-parent'));
      }
      return kind === 'parent' ? join(root, 'new-parent') : root;
    } };
    const before = witness(f);
    const result = sync(f, { targets: [changingTarget] });
    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    if (kind === 'file') expect(readFileSync(target, 'utf8')).toBe('Another invocation owns these bytes.\n');
    if (kind === 'symlink') expect(readlinkSync(target)).toBe(outside);
    if (kind === 'parent') expect(result.errors[0].error).toMatch(/symlink ancestor/);
    expect(readdirSync(outside)).toEqual([]);
    // The injected parent itself is untracked; inspect byte/index/ref invariants
    // separately instead of pretending the test mutation never happened.
    const after = witness(f);
    expect(after.head).toBe(before.head);
    expect(after.index).toBe(before.index);
    expect(after.refs).toBe(before.refs);
  });

  test('rejects an outside target and an existing symlink ancestor before mkdir', () => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    const root = betaOnly(f);
    const outside = join(fixture, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(root, 'escape'));
    const before = witness(f);
    const result = sync(f, { targets: [
      { label: 'outside', path: outside }, { label: 'escape', path: join(root, 'escape', 'nested') },
    ] });
    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(readdirSync(outside)).toEqual([]);
    expect(witness(f)).toEqual(before);
  });

  test('does not project through an untracked nested repository', () => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    const root = betaOnly(f);
    const nested = join(root, 'nested');
    mkdirSync(nested);
    git(nested, 'init', '--quiet');
    put(join(nested, 'README.md'), 'Independent synthetic repository.\n');
    git(nested, 'add', 'README.md');
    git(nested, 'commit', '--quiet', '-m', 'Nested fixture');
    const before = witness(f);
    const nestedIndex = git(nested, 'ls-files', '--stage', '-z');
    const nestedHead = git(nested, 'rev-parse', 'HEAD');
    const result = sync(f, { targets: [{ label: 'nested repository', path: join(nested, 'skills') }] });
    expect(result.created).toBe(0);
    expect(result.errors[0].error).toMatch(/nested Git worktree/);
    expect(existsSync(join(nested, 'skills'))).toBe(false);
    expect(git(nested, 'ls-files', '--stage', '-z')).toBe(nestedIndex);
    expect(git(nested, 'rev-parse', 'HEAD')).toBe(nestedHead);
    expect(witness(f)).toEqual(before);
  });

  test.each([
    ['missing native sparse matcher', "if (args.includes('check-rules')) process.exit(129);"],
    ['unknown sparse configuration', "if (args.includes('core.sparseCheckout')) { process.stdout.write('unknown\\n'); process.exit(0); }"],
    ['truncated index response', "if (args.includes('ls-files')) { process.stdout.write('partial'); process.exit(0); }"],
    ['oversized index response', "if (args.includes('ls-files')) { require('node:fs').writeSync(1, Buffer.alloc(17 * 1024 * 1024, 65)); process.exit(0); }"],
    ['unexpected sparse response', "if (args.includes('check-rules')) { process.stdout.write('unexpected/path\\0'); process.exit(0); }"],
    ['timed out sparse matcher', "if (args.includes('check-rules')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); process.exit(0); }"],
  ])('refuses writes for %s and preserves index, refs and bytes', (_label, fault) => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    betaOnly(f);
    const before = witness(f);
    const result = withGitFault(fault, () => sync(f));
    expect(result.created).toBe(0);
    expect(result.replaced).toBe(0);
    expect(result.errors).toHaveLength(16);
    expect(witness(f)).toEqual(before);
    for (const target of runtimeSkillTargets(f.worktree, 'project')) expect(existsSync(join(target.path, 'beta'))).toBe(false);
  }, 15_000);

  test('strips inherited Git selectors and tracing without changing the selected worktree', () => {
    const f = sparseFixture();
    betaOnly(f);
    const before = witness(f);
    const decoyIndex = join(fixture, 'decoy-index');
    put(decoyIndex, 'Not a Git index.\n');
    const trace = join(fixture, 'unexpected-trace');
    const result = withEnv({ GIT_DIR: join(f.main, '.git'), GIT_WORK_TREE: f.main,
      GIT_COMMON_DIR: join(f.main, '.git'), GIT_INDEX_FILE: decoyIndex, GIT_TRACE: trace,
      GIT_TRACE2: trace, GIT_TRACE2_EVENT: trace, GIT_TRACE2_PERF: trace,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sparseCheckout', GIT_CONFIG_VALUE_0: 'false',
    }, () => sync(f));
    expect(result.created).toBe(0);
    expect(result.errors).toEqual([]);
    expect(existsSync(trace)).toBe(false);
    expect(readFileSync(decoyIndex, 'utf8')).toBe('Not a Git index.\n');
    expect(witness(f)).toEqual(before);
  });

  test('the actual wrapper binds a nested cwd to its own linked worktree despite foreign Git selectors', () => {
    const f = sparseFixture();
    const before = witness(f);
    const trace = join(fixture, 'wrapper-trace');
    const result = withEnv({ GIT_DIR: join(f.main, '.git'), GIT_WORK_TREE: f.main,
      GIT_COMMON_DIR: join(f.main, '.git'), GIT_TRACE2_EVENT: trace,
    }, () => runWrapper(join(f.worktree, 'keep'), ['--scope', 'project', '--quiet']));
    expect(result.exit).toBeUndefined();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].baseDir).toBe(f.worktree);
    expect(result.calls[0].projectRoot).toBe(f.worktree);
    expect(existsSync(trace)).toBe(false);
    expect(witness(f)).toEqual(before);
  });

  test('the actual npm skills:sync alias selects the runtime-link wrapper, not the copy generator', () => {
    const f = sparseFixture();
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    const [runner, script, ...args] = pkg.scripts['skills:sync'].split(/\s+/);
    expect(runner).toBe('tsx');
    expect(script).toBe('scripts/sync-skills.ts');
    const result = runWrapper(f.worktree, [...args, '--quiet']);
    expect(result.exit).toBeUndefined();
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].scope).toBe('project');
    expect(result.calls[0].baseDir).toBe(f.worktree);
  });

  test.each([
    ['failed root read', "if (args.includes('rev-parse')) process.exit(1);"],
    ['foreign root response', "if (args.includes('rev-parse')) { process.stdout.write('/foreign/root\\n'); process.exit(0); }"],
  ])('the actual wrapper refuses %s before catalog discovery', (_label, fault) => {
    const f = sparseFixture();
    const before = witness(f);
    const result = withGitFault(fault, () => runWrapper(join(f.worktree, 'keep'), ['--quiet']));
    expect(result.exit).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toBe('sync-skills: unable to verify the selected project root; no links written\n');
    expect(witness(f)).toEqual(before);
  });

  test('quiet wrapper reports policy errors instead of silently failing a hook', () => {
    const f = sparseFixture();
    const result = runWrapper(f.worktree, ['--quiet'], [{ target: 'fixture', error: 'bounded refusal' }]);
    expect(result.exit).toBe(1);
    expect(result.stdout).toContain('safe policy error');
  });

  test('an invalid Git marker never downgrades to a writable cwd fallback', () => {
    const root = join(fixture, 'nongit');
    mkdirSync(root);
    put(join(root, '.git'), 'not a worktree pointer');
    const result = runWrapper(root, ['--quiet']);
    expect(result.exit).toBe(1);
    expect(result.calls).toEqual([]);
    expect(readdirSync(root)).toEqual(['.git']);
  });

  test('concurrent invocations create only included untracked links and preserve tracked mirrors', async () => {
    const f = sparseFixture();
    git(f.worktree, 'sparse-checkout', 'add', '.codex/skills');
    put(join(f.source, 'beta', 'SKILL.md'), '---\nname: beta\ndescription: Synthetic beta\n---\n');
    const before = witness(f);
    const options = { baseDir: f.worktree, projectRoot: f.worktree, scope: 'project',
      sourceRoots: [{ label: 'owned-fixture', path: f.source }] };
    const source = new URL('../../lib/skill-sync.ts', import.meta.url).href;
    const loader = createRequire(import.meta.url).resolve('tsx');
    const code = `import { syncAgentSkills } from ${JSON.stringify(source)}; console.log(JSON.stringify(syncAgentSkills(${JSON.stringify(options)})));`;
    const results = await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', loader, '--input-type=module', '-e', code], {
        cwd: f.worktree, env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000,
      });
      let out = '', err = '';
      child.stdout.on('data', (data) => { out += data; });
      child.stderr.on('data', (data) => { err += data; });
      child.on('error', reject);
      child.on('close', (status) => status === 0 ? resolve(JSON.parse(out)) : reject(Error(`Fixture child ${status}: ${err}`)));
    })));
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
    for (const result of results) { expect(result.errors).toEqual([]); expect(result.replaced).toBe(0); }
    expect(readlinkSync(join(f.worktree, '.codex', 'skills', 'beta'))).toBe(join(f.source, 'beta'));
    expect(witness(f)).toEqual(before);
  }, 30_000);
});
