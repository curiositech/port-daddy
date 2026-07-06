// Skill Graft — native, local skill-injection for fleet ships.
//
// All tests here use a deterministic bag-of-words mock embedder (same style
// as tests/unit/shipwright-skill-index.test.js) so ranking assertions are
// fast and Jest-safe. One suite ("real skills/ directory") points that mock
// embedder at this repo's actual ~290 SKILL.md files to prove the scanner
// survives real, hand-authored frontmatter drift, not just fixtures. The
// real-embedder half of "end to end" (the actual MiniLM pipeline) cannot run
// inside Jest's VM-modules sandbox — see the big comment near the bottom of
// this file and scripts/verify-skill-graft.ts for why and for the honest
// substitute.

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Database from 'better-sqlite3';

const {
  createSkillGraftIndex,
  defaultSkillGraftRoots,
  renderSkillGraftContext,
} = await import('../../lib/skill-graft.js');
const { createSkillIndex } = await import('../../lib/shipwright/skill-index.js');

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '../..');

// ─── Deterministic mock embedder (bag-of-words hashing, L2-normalized) ─────

function makeMockEmbedder() {
  return {
    modelId: 'mock/test-embedder',
    async embed(texts) {
      return texts.map((t) => deterministicVector(t));
    },
  };
}

function deterministicVector(text) {
  const v = new Array(64).fill(0);
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  for (const w of words) {
    let h = 0;
    for (let i = 0; i < w.length; i++) h = ((h << 5) - h + w.charCodeAt(i)) | 0;
    v[Math.abs(h) % 64] += 1;
  }
  const mag = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / mag);
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pd-skill-graft-test-'));
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSkill(rootDir, name, description, opts = {}) {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  const tags = Array.isArray(opts.tags) ? `\n    - ${opts.tags.join('\n    - ')}` : '';
  const category = opts.category ? `category: ${opts.category}` : '';
  const fm = `---\nname: ${name}\ndescription: |\n  ${description}\nmetadata:\n  ${category}\n  tags:${tags}\n---\n\n${opts.body ?? `# ${name}\n\nBody for ${name}.`}\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm);
  if (opts.references) {
    const refDir = join(dir, 'references');
    mkdirSync(refDir, { recursive: true });
    for (const [relPath, content] of Object.entries(opts.references)) {
      const full = join(refDir, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  return dir;
}

function makeGraftIndex(rootDir, overrides = {}) {
  return createSkillGraftIndex({
    roots: [{ label: 'test', path: rootDir }],
    embedder: makeMockEmbedder(),
    index: createSkillIndex({ db: new Database(':memory:'), embedder: makeMockEmbedder() }),
    ...overrides,
  });
}

// ─── craft(): shortlist + top-K full body ──────────────────────────────────

describe('createSkillGraftIndex().craft', () => {
  test('ranks skills by similarity and returns a cheap shortlist', async () => {
    writeSkill(tmpRoot, 'duckdb-analytics', 'analytical SQL over parquet csv json duckdb olap columnar', { category: 'Data' });
    writeSkill(tmpRoot, 'oauth2-and-oidc-from-scratch', 'oauth2 oidc pkce authorization code flow token refresh', { category: 'Auth' });
    writeSkill(tmpRoot, 'rag-retrieval-pattern-design', 'rag retrieval chunking hybrid bm25 dense reranking ragas', { category: 'AI' });

    const graft = makeGraftIndex(tmpRoot);
    const result = await graft.craft('parquet columnar olap analytics duckdb');

    expect(result.scannedCount).toBe(3);
    expect(result.shortlist).toHaveLength(3);
    expect(result.shortlist[0].id).toBe('duckdb-analytics');
    expect(result.shortlist[0].similarity).toBeGreaterThan(result.shortlist[1].similarity);
    expect(result.shortlist[0].description).toContain('duckdb');
    expect(result.roots).toEqual([{ label: 'test', path: tmpRoot }]);
  });

  test('attaches full SKILL.md body only to the top `topLimit` entries', async () => {
    writeSkill(tmpRoot, 'a-skill', 'alpha topic words repeated alpha alpha', { body: '# a-skill\n\nFull alpha body.' });
    writeSkill(tmpRoot, 'b-skill', 'alpha adjacent words somewhat related', { body: '# b-skill\n\nFull beta body.' });
    writeSkill(tmpRoot, 'c-skill', 'completely unrelated zebra giraffe elephant', { body: '# c-skill\n\nFull gamma body.' });

    const graft = makeGraftIndex(tmpRoot);
    const result = await graft.craft('alpha topic words', { topLimit: 1 });

    expect(result.shortlist).toHaveLength(3);
    expect(result.top).toHaveLength(1);
    expect(result.top[0].id).toBe('a-skill');
    expect(result.top[0].body).toContain('Full alpha body.');
    // Non-top shortlist entries never carry a body field.
    expect(result.shortlist[1]).not.toHaveProperty('body');
  });

  test('clamps invalid or out-of-range limits to sane defaults', async () => {
    for (let i = 0; i < 5; i++) {
      writeSkill(tmpRoot, `skill-${i}`, `topic number ${i} words filler content`);
    }
    const graft = makeGraftIndex(tmpRoot);

    const zero = await graft.craft('topic words', { shortlistLimit: 0, topLimit: -1 });
    expect(zero.shortlist.length).toBeGreaterThan(0); // fell back to default (10), not 0
    expect(zero.top.length).toBeGreaterThan(0); // fell back to default (3), not -1/0

    const huge = await graft.craft('topic words', { shortlistLimit: 999999 });
    expect(huge.shortlist.length).toBeLessThanOrEqual(50); // capped, not unbounded

    const nonNumber = await graft.craft('topic words', { shortlistLimit: 'lots' });
    expect(nonNumber.shortlist.length).toBeGreaterThan(0);
  });

  test('topLimit is never larger than the effective shortlistLimit', async () => {
    for (let i = 0; i < 5; i++) writeSkill(tmpRoot, `skill-${i}`, `topic ${i} filler`);
    const graft = makeGraftIndex(tmpRoot);
    const result = await graft.craft('topic filler', { shortlistLimit: 2, topLimit: 10 });
    expect(result.shortlist).toHaveLength(2);
    expect(result.top.length).toBeLessThanOrEqual(2);
  });

  test('empty or whitespace-only query returns an empty result without touching the embedder', async () => {
    writeSkill(tmpRoot, 'only-skill', 'some description');
    let embedCalls = 0;
    const countingEmbedder = {
      modelId: 'counting',
      async embed(texts) {
        embedCalls += 1;
        return texts.map(() => deterministicVector('x'));
      },
    };
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder: countingEmbedder,
      index: createSkillIndex({ db: new Database(':memory:'), embedder: countingEmbedder }),
    });

    const result = await graft.craft('   ');
    expect(result.shortlist).toEqual([]);
    expect(result.top).toEqual([]);
    // Indexing itself does embed (to build the catalog vectors); assert we
    // never issued a SECOND embed call for a blank query specifically.
    const callsAfterEmptyQuery = embedCalls;
    await graft.craft('   ');
    expect(embedCalls).toBe(callsAfterEmptyQuery); // no extra embed call for another blank query
  });

  test('malformed SKILL.md frontmatter is skipped with a warning, never thrown', async () => {
    const badDir = join(tmpRoot, 'broken-skill');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'SKILL.md'), '---\nname: [this is not: valid: yaml\n---\nbody');
    writeSkill(tmpRoot, 'good-skill', 'a perfectly fine skill description');

    const warnings = [];
    const graft = makeGraftIndex(tmpRoot, { onWarning: (msg) => warnings.push(msg) });
    const result = await graft.craft('fine skill description');

    expect(result.scannedCount).toBe(1); // only the good one
    expect(warnings.length).toBeGreaterThan(0);
  });
});

// ─── getReference(): on-demand single-file fetch ───────────────────────────

describe('createSkillGraftIndex().getReference', () => {
  test('reads a real reference file from within a skill directory', async () => {
    writeSkill(tmpRoot, 'has-refs', 'a skill with a references directory', {
      references: { 'notes.md': '# Deep notes\n\nExtra depth here.' },
    });
    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh(); // populate the catalog before getReference

    const ref = graft.getReference('has-refs', 'references/notes.md');
    expect(ref.found).toBe(true);
    expect(ref.content).toContain('Extra depth here.');
    expect(ref.absolutePath).toContain('has-refs');
  });

  test('refuses a path that escapes the skill directory', async () => {
    writeSkill(tmpRoot, 'victim-skill', 'a normal skill');
    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();

    const escape = graft.getReference('victim-skill', '../../../../../../etc/passwd');
    expect(escape.found).toBe(false);
    expect(escape.content).toBeNull();
    expect(escape.error).toMatch(/refused/i);
  });

  test('returns found:false for an unknown skill id', async () => {
    writeSkill(tmpRoot, 'known-skill', 'a normal skill');
    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();

    const missing = graft.getReference('does-not-exist', 'references/notes.md');
    expect(missing.found).toBe(false);
    expect(missing.error).toMatch(/unknown skill id/);
  });

  test('returns found:false (not a throw) for a file that does not exist in a real skill dir', async () => {
    writeSkill(tmpRoot, 'sparse-skill', 'a skill with no references dir');
    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();

    const missing = graft.getReference('sparse-skill', 'references/nope.md');
    expect(missing.found).toBe(false);
    expect(missing.content).toBeNull();
    expect(missing.error).toMatch(/not found/);
  });
});

// ─── refresh(): cache accounting ────────────────────────────────────────────

describe('createSkillGraftIndex().refresh', () => {
  test('first refresh embeds everything; a second unchanged refresh reuses the cache', async () => {
    writeSkill(tmpRoot, 'cache-me', 'a skill whose content will not change');
    const sharedDb = new Database(':memory:');
    const embedder = makeMockEmbedder();
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder,
      index: createSkillIndex({ db: sharedDb, embedder }),
    });

    const first = await graft.refresh();
    expect(first.scannedCount).toBe(1);
    expect(first.embedded).toBe(1);
    expect(first.reused).toBe(0);

    const second = await graft.refresh();
    expect(second.embedded).toBe(0);
    expect(second.reused).toBe(1);
  });

  test('listSkillIds reflects the catalog after a scan', async () => {
    writeSkill(tmpRoot, 'alpha', 'alpha desc');
    writeSkill(tmpRoot, 'beta', 'beta desc');
    const graft = makeGraftIndex(tmpRoot);

    expect(graft.listSkillIds()).toEqual([]); // nothing scanned yet
    await graft.refresh();
    expect(graft.listSkillIds().sort()).toEqual(['alpha', 'beta']);
  });
});

// ─── defaultSkillGraftRoots ─────────────────────────────────────────────────

describe('defaultSkillGraftRoots', () => {
  test('defaults to just <projectRoot>/skills — no windags/workgroup-ai reach-out', () => {
    const roots = defaultSkillGraftRoots('/Users/example/coding/port-daddy');
    expect(roots).toEqual([{ label: 'port-daddy', path: '/Users/example/coding/port-daddy/skills' }]);
  });
});

// ─── renderSkillGraftContext ────────────────────────────────────────────────

describe('renderSkillGraftContext', () => {
  test('renders an empty string when there is nothing to inject', () => {
    expect(renderSkillGraftContext({ query: 'x', scannedCount: 0, roots: [], shortlist: [], top: [] })).toBe('');
  });

  test('renders the shortlist and full bodies for top matches', () => {
    const text = renderSkillGraftContext({
      query: 'hybrid retrieval',
      scannedCount: 42,
      roots: [{ label: 'port-daddy', path: '/x/skills' }],
      shortlist: [
        { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.83 },
        { id: 'duckdb-analytics', description: 'Analytical SQL over parquet', category: 'Data', tags: [], similarity: 0.41 },
      ],
      top: [
        { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.83, body: '# RAG\n\nFull body content.', sourcePath: '/x/skills/rag-retrieval-pattern-design/SKILL.md' },
      ],
    });

    expect(text).toContain('42 scanned');
    expect(text).toContain('rag-retrieval-pattern-design (similarity 0.83)');
    expect(text).toContain('duckdb-analytics (similarity 0.41)');
    expect(text).toContain('Full body content.');
    // Only the top entry's body is inlined — the second shortlist entry's
    // one-liner appears, but its (nonexistent) body never does.
    expect(text.indexOf('Full body content.')).toBeGreaterThan(text.indexOf('duckdb-analytics'));
  });
});

// ─── Real skills/ directory, mock embedder (Jest-safe) ─────────────────────
//
// Proves the scanner/parser survives EVERY real SKILL.md in this repo (not
// just hand-written fixtures) without crashing or dropping entries it
// shouldn't. Uses the mock embedder so it stays fast and Jest-safe; the
// real-embedder half of "end to end" is covered by
// scripts/verify-skill-graft.ts (see the big comment below for why that
// lives outside Jest).
describe('real skills/ directory (mock embedder, Jest-safe)', () => {
  test('scans every real SKILL.md in this repo without throwing', async () => {
    const graft = createSkillGraftIndex({
      roots: defaultSkillGraftRoots(REPO_ROOT),
      embedder: makeMockEmbedder(),
      index: createSkillIndex({ db: new Database(':memory:'), embedder: makeMockEmbedder() }),
    });

    const stats = await graft.refresh();
    expect(stats.scannedCount).toBeGreaterThan(100);

    const ids = new Set(graft.listSkillIds());
    expect(ids.has('rag-retrieval-pattern-design')).toBe(true);
    expect(ids.has('duckdb-analytics')).toBe(true);
    expect(ids.has('semantic-conflict-prediction')).toBe(true);

    // getReference against a real skill's real script file on disk (still
    // exercises the real containPath + fs read path, no embedder involved).
    const ref = graft.getReference('rag-retrieval-pattern-design', 'scripts/rag_retrieval_pattern_design_audit.mjs');
    expect(ref.found).toBe(true);
    expect(ref.content.length).toBeGreaterThan(0);
  });
});

// ─── Real end-to-end: the actual embedder, the actual skills/ directory ────
//
// This is deliberately NOT a Jest test. The real @huggingface/transformers
// pipeline (onnxruntime-node) throws when invoked from inside Jest's
// `--experimental-vm-modules` ESM sandbox:
//
//   TypeError: A float32 tensor's data must be type of function Float32Array()
//
// — a cross-realm TypedArray identity check failing inside Jest's VM
// context. Confirmed via a plain `tsx`/`node` run outside Jest with the
// exact same embed() call: it succeeds cleanly (384-dim vectors, no error).
// This is a pre-existing Jest+onnxruntime-node incompatibility in this
// repo, not a skill-graft bug — no existing test anywhere here exercises
// the real transformers.js pipeline under Jest either
// (tests/unit/semantic-resolver.test.js and
// tests/unit/shipwright-skill-index.test.js both inject a deterministic
// mock embedder for the same underlying reason).
//
// The honest substitute: scripts/verify-skill-graft.ts is a real,
// repo-checked-in, runnable script that does the full real-embedder +
// real-skills-directory + real-reference-file + path-traversal-refusal
// check outside Jest. Run it with:
//
//   npx tsx scripts/verify-skill-graft.ts
//
// (Verified passing as part of this change: scanned 292 real skills,
// ranked rag-retrieval-pattern-design #1 for a retrieval-shaped query,
// attached its full SKILL.md body, fetched a real reference file, and
// correctly refused a path-traversal escape attempt. A second run showed
// `embedded 0, reused 292` — the persisted vector cache works.)
