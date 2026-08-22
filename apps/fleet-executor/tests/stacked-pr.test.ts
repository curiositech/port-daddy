import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateStackedFiles,
  createOrUpdateBranch,
  openStackedPr,
  retargetPrBase,
  fetchRepoFileText,
  fetchRepoTreePaths,
  GitHubApiError,
  MAX_STACKED_FILES,
  MAX_STACKED_FILE_BYTES,
} from '../src/stacked-pr.js';
import { freshState, installGitHubFetch, type GitHubState } from './harness.js';

const OWNER = 'erichowens';
const REPO = 'port-daddy';
const TOKEN = 'tok';

let state: GitHubState;

beforeEach(() => {
  state = freshState();
  installGitHubFetch(state);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateStackedFiles — path safety + caps', () => {
  const ok = (path: string) => validateStackedFiles([{ path, contents: 'x' }]);

  it('accepts sane nested relative paths', () => {
    expect(ok('tests/purser/contract.test.ts')).toEqual({ ok: true });
    expect(ok('apps/fleet-executor/tests/a-b_c.d.test.ts')).toEqual({ ok: true });
  });

  it('rejects path traversal (`..`)', () => {
    expect(ok('../evil.test.ts').ok).toBe(false);
    expect(ok('tests/../../evil.ts').ok).toBe(false);
    expect(ok('tests/..').ok).toBe(false);
  });

  it('rejects absolute paths and backslashes', () => {
    expect(ok('/etc/passwd').ok).toBe(false);
    expect(ok('tests\\evil.ts').ok).toBe(false);
  });

  it('rejects paths outside the whitelist (spaces, shell metachars, dot-leading segments)', () => {
    expect(ok('tests/has space.ts').ok).toBe(false);
    expect(ok('tests/$(rm -rf).ts').ok).toBe(false);
    expect(ok('.github/workflows/pwn.yml').ok).toBe(false); // dot-leading segment
    expect(ok('tests/;x.ts').ok).toBe(false);
  });

  it('rejects more than the file-count cap', () => {
    const files = Array.from({ length: MAX_STACKED_FILES + 1 }, (_, i) => ({
      path: `tests/t${i}.test.ts`,
      contents: 'x',
    }));
    const v = validateStackedFiles(files);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/too many files/);
  });

  it('rejects a file over the per-file byte cap', () => {
    const v = validateStackedFiles([
      { path: 'tests/big.test.ts', contents: 'a'.repeat(MAX_STACKED_FILE_BYTES + 1) },
    ]);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/too large/);
  });

  it('rejects an empty set, duplicates, and malformed entries', () => {
    expect(validateStackedFiles([]).ok).toBe(false);
    expect(
      validateStackedFiles([
        { path: 'tests/a.ts', contents: 'x' },
        { path: 'tests/a.ts', contents: 'y' },
      ]).ok,
    ).toBe(false);
    expect(
      validateStackedFiles([{ path: 'tests/a.ts' } as unknown as { path: string; contents: string }]).ok,
    ).toBe(false);
  });
});

describe('createOrUpdateBranch — blobs → tree → commit → ref, idempotent', () => {
  const FILES = [{ path: 'tests/purser/a.test.ts', contents: 'it("a")' }];

  it('creates blob(s), a tree on the base commit tree, a commit parented on fromSha, and the ref', async () => {
    const res = await createOrUpdateBranch(OWNER, REPO, 'purser/pr-7-tests', 'BASESHA', FILES, 'msg', TOKEN);

    expect(res.created).toBe(true);
    expect(state.blobsCreated).toBe(1);
    expect(state.treesCreated).toBe(1);
    expect(state.commitsCreated).toBe(1);
    expect(state.refCreates).toBe(1);
    expect(state.refUpdates).toBe(0);
    expect(state.gitRefs.get('purser/pr-7-tests')).toBe(res.commitSha);

    // The commit was parented on the fromSha and used the base commit's tree.
    const commitPost = state.records.find(r => r.method === 'POST' && /\/git\/commits$/.test(r.url));
    expect((commitPost!.body as { parents: string[] }).parents).toEqual(['BASESHA']);
    const treePost = state.records.find(r => r.method === 'POST' && /\/git\/trees$/.test(r.url));
    expect((treePost!.body as { base_tree: string }).base_tree).toBe('tree-of-BASESHA');
  });

  it('a second run for the same branch force-updates the existing ref (idempotent retry)', async () => {
    const first = await createOrUpdateBranch(OWNER, REPO, 'purser/pr-7-tests', 'BASESHA', FILES, 'msg', TOKEN);
    const second = await createOrUpdateBranch(OWNER, REPO, 'purser/pr-7-tests', 'BASESHA', FILES, 'msg', TOKEN);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(state.refCreates).toBe(1); // only the first POST succeeded
    expect(state.refUpdates).toBe(1); // the retry PATCHed with force
    expect(state.gitRefs.get('purser/pr-7-tests')).toBe(second.commitSha);
    const patch = state.records.find(r => r.method === 'PATCH' && /\/git\/refs\/heads\//.test(r.url));
    expect((patch!.body as { force: boolean }).force).toBe(true);
  });

  it('throws GitHubApiError with status 403 when the App lacks contents:write', async () => {
    state.failGitWrites403 = true;
    await expect(
      createOrUpdateBranch(OWNER, REPO, 'purser/pr-7-tests', 'BASESHA', FILES, 'msg', TOKEN),
    ).rejects.toSatisfy((err: unknown) => err instanceof GitHubApiError && err.status === 403);
  });

  it('refuses an invalid file set before touching GitHub', async () => {
    await expect(
      createOrUpdateBranch(OWNER, REPO, 'b', 'BASESHA', [{ path: '../x', contents: '' }], 'm', TOKEN),
    ).rejects.toThrow(/refused/);
    expect(state.records).toHaveLength(0);
  });
});

describe('openStackedPr — idempotent create', () => {
  it('creates the PR with labels on first call', async () => {
    const pr = await openStackedPr(OWNER, REPO, 'purser/pr-7-tests', 'main', 'purser: adversarial tests for #7', 'body', ['purser'], TOKEN);

    expect(pr.existed).toBe(false);
    expect(state.stackedPrs).toHaveLength(1);
    expect(state.stackedPrs[0]).toMatchObject({
      head: 'purser/pr-7-tests',
      base: 'main',
      title: 'purser: adversarial tests for #7',
    });
    expect(state.labelPosts).toEqual([{ number: pr.number, labels: ['purser'] }]);
  });

  it('finds and reuses an existing open PR for the head branch (no duplicate)', async () => {
    const first = await openStackedPr(OWNER, REPO, 'purser/pr-7-tests', 'main', 't', 'b', [], TOKEN);
    const second = await openStackedPr(OWNER, REPO, 'purser/pr-7-tests', 'main', 't2', 'b2', [], TOKEN);

    expect(second.existed).toBe(true);
    expect(second.number).toBe(first.number);
    expect(state.stackedPrs).toHaveLength(1); // only one POST /pulls
    // The reuse path refreshed title/body in place.
    expect(state.prPatches).toContainEqual({
      number: first.number,
      base: undefined,
      title: 't2',
      body: 'b2',
    });
  });
});

describe('retargetPrBase', () => {
  it('PATCHes the PR base to the new branch', async () => {
    await retargetPrBase(OWNER, REPO, 7, 'purser/pr-7-tests', TOKEN);
    expect(state.prPatches).toContainEqual({
      number: 7,
      base: 'purser/pr-7-tests',
      title: undefined,
      body: undefined,
    });
  });
});

describe('fetchRepoFileText — evidence for the purser executability gate', () => {
  it('returns the decoded text of a seeded file', async () => {
    state.files.set('BASESHA:jest.config.js', "module.exports = { testMatch: ['x'] };");
    const text = await fetchRepoFileText(OWNER, REPO, 'jest.config.js', 'BASESHA', TOKEN);
    expect(text).toBe("module.exports = { testMatch: ['x'] };");
  });

  it('returns null on 404 (file absent) rather than throwing', async () => {
    const text = await fetchRepoFileText(OWNER, REPO, 'nope.config.js', 'BASESHA', TOKEN);
    expect(text).toBeNull();
  });

  it('never trusts the PR head — reads whatever ref it is given, verified via contentsRefs', async () => {
    state.files.set('BASESHA:jest.config.js', 'x');
    await fetchRepoFileText(OWNER, REPO, 'jest.config.js', 'BASESHA', TOKEN);
    expect(state.contentsRefs).toContainEqual({ path: 'jest.config.js', ref: 'BASESHA' });
  });
});

describe('fetchRepoTreePaths — evidence for the purser executability gate', () => {
  it('returns the set of paths from a seeded recursive tree', async () => {
    state.treeFiles.set('BASESHA', ['tests/unit/a.test.ts', 'tests/support.js']);
    const paths = await fetchRepoTreePaths(OWNER, REPO, 'BASESHA', TOKEN);
    expect(paths).toEqual(new Set(['tests/unit/a.test.ts', 'tests/support.js']));
  });

  it('returns null when the tree was never seeded (unknown, not empty)', async () => {
    const paths = await fetchRepoTreePaths(OWNER, REPO, 'NOSUCHSHA', TOKEN);
    expect(paths).toBeNull();
  });
});
