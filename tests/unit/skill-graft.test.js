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
const { porterStem, tokenizeAndStem, bm25Rank } = await import('../../lib/skill-graft-bm25.js');
const { createTool2VecStore, computeCentroid, getOrBuildCentroid } = await import('../../lib/skill-graft-tool2vec.js');

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
  // `pairsWith`: array of target skill ids — rendered as the same
  // `metadata.pairs-with: [{skill, reason}]` shape real SKILL.md files in
  // this repo use (see rag-retrieval-pattern-design/SKILL.md). Omitted
  // entirely when not passed, so every pre-existing writeSkill() call is
  // byte-for-byte unaffected.
  const pairsWith = Array.isArray(opts.pairsWith) && opts.pairsWith.length > 0
    ? `\n  pairs-with:\n${opts.pairsWith.map((id) => `    - skill: ${id}\n      reason: test fixture edge`).join('\n')}`
    : '';
  const fm = `---\nname: ${name}\ndescription: |\n  ${description}\nmetadata:\n  ${category}\n  tags:${tags}${pairsWith}\n---\n\n${opts.body ?? `# ${name}\n\nBody for ${name}.`}\n`;
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

// ─── Deterministic mock synthetic-query generator (Tool2Vec's LLM stage) ───
//
// Production builds this from an LLMClient (createLLMClientSyntheticQueryGenerator
// in lib/skill-graft-tool2vec.ts); tests inject a plain function instead so
// centroid math is exercised with zero network/LLM involvement. Default
// behavior derives "queries" from the skill's own fields — fine for tests
// that only care about ranking mechanics — but any test can override a
// specific skill's synthetic queries via `queriesById` to prove Tool2Vec
// actually closes a vocabulary gap (see "vocabulary-mismatch" below), since
// the whole point is that a skill's centroid need NOT resemble its own
// description text.
function makeMockSyntheticQueryGenerator(queriesById = {}) {
  return async (skill, count) => {
    if (queriesById[skill.id]) return queriesById[skill.id];
    const base = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.trim();
    return Array.from({ length: count }, (_, i) => `${base} example task variant ${i}`);
  };
}

function makeCentroidStore() {
  return createTool2VecStore({
    db: new Database(':memory:'),
    embedderModelId: 'mock/test-embedder',
    generatorId: 'mock-generator',
  });
}

function makeGraftIndex(rootDir, overrides = {}) {
  const { syntheticQueriesById, ...rest } = overrides;
  return createSkillGraftIndex({
    roots: [{ label: 'test', path: rootDir }],
    embedder: makeMockEmbedder(),
    generateSyntheticQueries: makeMockSyntheticQueryGenerator(syntheticQueriesById),
    centroidStore: makeCentroidStore(),
    ...rest,
  });
}

// ─── craft(): shortlist + top-K full body ──────────────────────────────────

describe('createSkillGraftIndex().craft', () => {
  test('ranks skills by similarity and returns a cheap shortlist', async () => {
    writeSkill(tmpRoot, 'duckdb-analytics', 'analytical SQL over parquet csv json duckdb olap columnar', { category: 'Data' });
    writeSkill(tmpRoot, 'oauth2-and-oidc-from-scratch', 'oauth2 oidc pkce authorization code flow token refresh', { category: 'Auth' });
    writeSkill(tmpRoot, 'rag-retrieval-pattern-design', 'rag retrieval chunking hybrid bm25 dense reranking ragas', { category: 'AI' });

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh(); // build Tool2Vec centroids — craft() itself never does (explicit precompute)
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
    await graft.refresh(); // build Tool2Vec centroids — craft() itself never does (explicit precompute)
    const result = await graft.craft('alpha topic words', { topLimit: 1 });

    expect(result.shortlist).toHaveLength(3);
    expect(result.top).toHaveLength(1);
    expect(result.top[0].id).toBe('a-skill');
    expect(result.top[0].body).toContain('Full alpha body.');
    // Non-top shortlist entries never carry a body field.
    expect(result.shortlist[1]).not.toHaveProperty('body');
  });

  test('truncates a top body over maxBodyChars with an explicit marker (never blows up the task)', async () => {
    const hugeBody = `# huge-skill\n\n${'x'.repeat(20000)}`;
    writeSkill(tmpRoot, 'huge-skill', 'a skill with an enormous SKILL.md body', { body: hugeBody });
    writeSkill(tmpRoot, 'small-skill', 'a skill with a small SKILL.md body');

    const graft = makeGraftIndex(tmpRoot, { maxBodyChars: 500 });

    const result = await graft.craft('huge enormous body', { topLimit: 1 });
    expect(result.top).toHaveLength(1);
    expect(result.top[0].id).toBe('huge-skill');
    expect(result.top[0].body.length).toBeLessThan(600); // capped, not the full ~20KB body
    expect(result.top[0].body).toMatch(/\[truncated \d+ chars\]$/);
  });

  test('clamps an invalid maxBodyChars to the default rather than disabling the cap', async () => {
    const hugeBody = `# huge-skill\n\n${'x'.repeat(20000)}`;
    writeSkill(tmpRoot, 'huge-skill', 'a skill with an enormous SKILL.md body', { body: hugeBody });

    const graft = makeGraftIndex(tmpRoot, { maxBodyChars: -1 }); // invalid — must not disable the cap

    const result = await graft.craft('huge enormous body', { topLimit: 1 });
    expect(result.top[0].body.length).toBeLessThan(hugeBody.length);
    expect(result.top[0].body).toContain('[truncated');
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
      generateSyntheticQueries: makeMockSyntheticQueryGenerator(),
      centroidStore: createTool2VecStore({ db: new Database(':memory:'), embedderModelId: 'counting', generatorId: 'mock-generator' }),
    });

    await graft.refresh(); // explicit precompute — does embed (one call per skill's centroid)
    expect(embedCalls).toBeGreaterThan(0); // indexing already ran

    const result = await graft.craft('   ');
    expect(result.shortlist).toEqual([]);
    expect(result.top).toEqual([]);
    // Assert we never issued an ADDITIONAL embed call for a blank query
    // specifically — craft() returns early before ever calling
    // embedder.embed() on the (blank) query text.
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
    let generatorCalls = 0;
    const countingGenerator = async (skill, count) => {
      generatorCalls += 1;
      return makeMockSyntheticQueryGenerator()(skill, count);
    };
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder,
      generateSyntheticQueries: countingGenerator,
      centroidStore: createTool2VecStore({ db: sharedDb, embedderModelId: embedder.modelId, generatorId: 'counting-generator' }),
    });

    const first = await graft.refresh();
    expect(first.scannedCount).toBe(1);
    expect(first.embedded).toBe(1);
    expect(first.reused).toBe(0);
    expect(generatorCalls).toBe(1);

    const second = await graft.refresh();
    expect(second.embedded).toBe(0);
    expect(second.reused).toBe(1);
    // The point of content-hash-keyed caching: an unchanged skill NEVER
    // triggers a second LLM call on the next refresh.
    expect(generatorCalls).toBe(1);
  });

  test('a changed SKILL.md (different content hash) regenerates the centroid instead of reusing stale cache', async () => {
    writeSkill(tmpRoot, 'evolving-skill', 'original description about topic alpha');
    const sharedDb = new Database(':memory:');
    const embedder = makeMockEmbedder();
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder,
      generateSyntheticQueries: makeMockSyntheticQueryGenerator(),
      centroidStore: createTool2VecStore({ db: sharedDb, embedderModelId: embedder.modelId, generatorId: 'mock-generator' }),
    });

    const first = await graft.refresh();
    expect(first.embedded).toBe(1);

    writeSkill(tmpRoot, 'evolving-skill', 'a completely rewritten description about topic beta');
    const second = await graft.refresh();
    expect(second.embedded).toBe(1); // content hash changed → regenerated, not reused
    expect(second.reused).toBe(0);
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

// ─── The actual bug fix: vocabulary-mismatch (Tool2Vec vs description) ─────
//
// THE BUG this PR fixes: the original ranker embedded a skill's OWN
// description text and compared it by cosine to the task's embedding —
// comparing a shovel to a bonsai tree. A task phrased in user language
// rarely shares vocabulary with a skill's own (differently-phrased)
// description, even when the skill is exactly right.
//
// This suite proves the fix actually closes that gap — not just that
// cosine similarity computes — by giving TWO skills descriptions that
// share ZERO tokens with the query (so BM25 alone would miss both), but
// giving ONE of them synthetic Tool2Vec queries phrased the way a real
// user would ask for it. Only the skill whose synthetic queries actually
// cover the user's phrasing should rank above the unrelated skill.
describe('Tool2Vec closes the vocabulary-mismatch gap (the bug this PR fixes)', () => {
  test('a plain-language task matches a skill whose OWN description uses different vocabulary', async () => {
    // Skill's own description deliberately shares NO tokens with the query
    // below ("fix a memory leak in the daemon") — this is the exact
    // shovel/bonsai-tree mismatch from the bug report. Under the OLD
    // (buggy) design — cosine(task, description) — this skill would rank
    // at or near zero. BM25 also can't help here (zero literal overlap).
    writeSkill(tmpRoot, 'heap-growth-detector', 'detects unbounded heap growth via snapshot diffing', { category: 'Observability' });
    // An unrelated skill, also with zero lexical overlap with the query,
    // and — critically — its synthetic queries are ALSO topically
    // unrelated, so it must NOT outrank the real match.
    writeSkill(tmpRoot, 'invoice-pdf-generator', 'renders itemized billing statements as printable documents', { category: 'Billing' });

    const graft = makeGraftIndex(tmpRoot, {
      syntheticQueriesById: {
        // The Tool2Vec centroid for heap-growth-detector: realistic,
        // user-phrased tasks — deliberately NOT reusing the description's
        // own words ("unbounded", "heap", "snapshot", "diffing").
        'heap-growth-detector': [
          'fix a memory leak in the daemon',
          'why does my process keep growing in RSS over time',
          'the server runs out of memory after a few hours, help debug it',
          'investigate a slow memory leak in production',
          'my node process OOMs after running for a while, what is leaking',
        ],
        'invoice-pdf-generator': [
          'generate a PDF invoice for a customer order',
          'create a printable billing statement',
          'render an itemized receipt as a document',
        ],
      },
    });

    await graft.refresh(); // build Tool2Vec centroids — craft() itself never does (explicit precompute)
    const result = await graft.craft('fix a memory leak in the daemon');

    expect(result.semanticTier).toBe('hybrid');
    expect(result.shortlist.length).toBeGreaterThan(0);
    expect(result.shortlist[0].id).toBe('heap-growth-detector');
    // The unrelated skill must not be ranked above the real match, even
    // though NEITHER skill shares a single lexical token with the query.
    const heapIdx = result.shortlist.findIndex((e) => e.id === 'heap-growth-detector');
    const invoiceIdx = result.shortlist.findIndex((e) => e.id === 'invoice-pdf-generator');
    if (invoiceIdx >= 0) expect(heapIdx).toBeLessThan(invoiceIdx);
  });

  test('BM25 still catches genuine keyword overlap the semantic tier under-weights', async () => {
    // A case built the other way: a skill whose synthetic queries (crafted
    // deliberately generic/unhelpful here) drift away from the literal
    // query, but whose OWN name/description/tags share strong literal
    // overlap with the task. RRF fusion means BM25's signal still surfaces
    // it — proving the fix isn't "semantic-only now" but genuinely hybrid.
    writeSkill(tmpRoot, 'postgres-connection-pooling', 'connection pool tuning pgbouncer pool size timeout', { category: 'Database', tags: ['postgres', 'pooling'] });
    writeSkill(tmpRoot, 'unrelated-skill', 'a skill about something else entirely', { category: 'Other' });

    const graft = makeGraftIndex(tmpRoot, {
      syntheticQueriesById: {
        // Deliberately generic/off-topic synthetic queries so this skill's
        // Tool2Vec centroid contributes little — BM25 has to carry it.
        'postgres-connection-pooling': ['a generic maintenance task', 'some infrastructure chore', 'a routine operations request'],
      },
    });

    await graft.refresh(); // build the (deliberately weak/off-topic) Tool2Vec centroid too — this must be a real RRF fusion, not just BM25 running alone
    const result = await graft.craft('tune connection pool size and timeout for postgres pgbouncer');
    expect(result.semanticTier).toBe('hybrid'); // both signals ran — BM25 is what carries the win here
    expect(result.shortlist[0].id).toBe('postgres-connection-pooling');
  });

  test('craft() never calls the synthetic-query generator — a cold cache stays lexical-only instead of blocking on LLM calls (Copilot review finding)', async () => {
    // A real fleet ship spawn calls craft() with no prior refresh(). With
    // ~290 real skills and 15 synthetic queries each, generating on demand
    // here would mean hundreds of LLM calls blocking a live spawn — a real
    // reliability/cost risk this test guards against regressing.
    for (let i = 0; i < 5; i++) writeSkill(tmpRoot, `skill-${i}`, `topic number ${i} filler words`);
    let generatorCalls = 0;
    const countingGenerator = async (skill, count) => {
      generatorCalls += 1;
      return makeMockSyntheticQueryGenerator()(skill, count);
    };
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder: makeMockEmbedder(),
      generateSyntheticQueries: countingGenerator,
      centroidStore: createTool2VecStore({ db: new Database(':memory:'), embedderModelId: 'mock/test-embedder', generatorId: 'counting' }),
    });

    const result = await graft.craft('topic filler'); // no refresh() called first
    expect(generatorCalls).toBe(0); // craft() never triggers generation itself
    expect(result.semanticTier).toBe('lexical-only'); // honest: nothing was cached to contribute

    await graft.refresh(); // the explicit, separate precompute step
    expect(generatorCalls).toBe(5); // now it actually built centroids, once per skill
  });
});

// ─── semanticTier: lexical-only fallback (no LLM configured) ───────────────

describe('craft() degrades to BM25-only, never throws, when no synthetic-query generator is configured', () => {
  test('ranks via BM25 alone and reports semanticTier: lexical-only', async () => {
    writeSkill(tmpRoot, 'duckdb-analytics', 'analytical SQL over parquet csv json duckdb olap columnar');
    writeSkill(tmpRoot, 'oauth2-and-oidc-from-scratch', 'oauth2 oidc pkce authorization code flow token refresh');

    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder: makeMockEmbedder(),
      // No generateSyntheticQueries, no llmClient, no centroidStore.
    });

    const result = await graft.craft('parquet columnar olap analytics duckdb');
    expect(result.semanticTier).toBe('lexical-only');
    expect(result.shortlist).toHaveLength(1); // only the lexically-overlapping skill
    expect(result.shortlist[0].id).toBe('duckdb-analytics');
    expect(result.shortlist[0].similarity).toBe(0); // no semantic tier ran
  });
});

// ─── BM25 + Porter stemming (lib/skill-graft-bm25.ts) ──────────────────────

describe('porterStem + tokenizeAndStem', () => {
  test('collapses common morphological variants to the same stem', () => {
    expect(porterStem('optimization')).toBe(porterStem('optimize'));
    expect(porterStem('optimizing')).toBe(porterStem('optimize'));
    expect(porterStem('detecting')).toBe(porterStem('detect'));
    expect(porterStem('connections')).toBe(porterStem('connection'));
    expect(porterStem('running')).toBe(porterStem('run'));
  });

  test('tokenizeAndStem lowercases, splits, and stems every token', () => {
    expect(tokenizeAndStem('Optimizing Database Connections')).toEqual(
      [porterStem('optimizing'), porterStem('database'), porterStem('connections')],
    );
  });
});

describe('bm25Rank', () => {
  test('ranks the skill with more literal term overlap higher', () => {
    const skills = [
      { id: 'a', name: 'a', description: 'optimize database connection pooling for postgres', category: '', tags: [], sourcePath: '', contentHash: '1' },
      { id: 'b', name: 'b', description: 'a completely unrelated skill about something else', category: '', tags: [], sourcePath: '', contentHash: '2' },
    ];
    const ranked = bm25Rank('optimizing database connections', skills);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].id).toBe('a');
  });

  test('an empty query returns no results', () => {
    const skills = [{ id: 'a', name: 'a', description: 'anything', category: '', tags: [], sourcePath: '', contentHash: '1' }];
    expect(bm25Rank('   ', skills)).toEqual([]);
  });
});

// ─── reciprocalRankFusion (lib/skill-graft.ts) ──────────────────────────────

describe('reciprocalRankFusion', () => {
  test('an id appearing in both lists outranks an id in only one list', async () => {
    const { reciprocalRankFusion } = await import('../../lib/skill-graft.js');
    const fused = reciprocalRankFusion(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
    );
    expect(fused[0].id).toBe('b'); // appears in both lists — rank 1 in each
    expect(fused.map((f) => f.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('ties break deterministically by id', async () => {
    const { reciprocalRankFusion } = await import('../../lib/skill-graft.js');
    const fused = reciprocalRankFusion([{ id: 'z' }], [{ id: 'a' }]);
    // Both rank #1 in their own (single-entry) list — identical fused score.
    expect(fused[0].id).toBe('a');
    expect(fused[1].id).toBe('z');
  });
});

// ─── First-hop candidate expansion (lib/skill-graft.ts) ────────────────────
//
// 2026-08-19 operator directive: widen the post-RRF candidate pool by one
// graph hop (pairs-with / prose-mention edges) from the top seeds, under
// the SAME shortlist/top/body caps craft() already enforced. These tests
// cover the algorithm directly (expandFirstHopCandidates, deterministic
// and fast — same style as the reciprocalRankFusion suite above) and, in a
// second describe block further down, the end-to-end path through craft()
// with real SKILL.md fixtures (pairs-with frontmatter + prose mentions).

describe('expandFirstHopCandidates', () => {
  test('pairs-with edge outranks prose-mention edge at equal seed score', async () => {
    const { expandFirstHopCandidates, PAIRS_WITH_WEIGHT, PROSE_MENTION_WEIGHT } = await import('../../lib/skill-graft.js');
    // Two seeds tied on fused score, one connected to its neighbor via
    // pairs-with, the other via a prose mention — isolates the weight
    // comparison from any seed-score difference.
    const fused = [
      { id: 'seed-pairs', fusedScore: 0.02 },
      { id: 'seed-prose', fusedScore: 0.02 },
    ];
    const adjacency = new Map([
      ['seed-pairs', [{ target: 'pairs-neighbor', weight: PAIRS_WITH_WEIGHT }]],
      ['seed-prose', [{ target: 'prose-neighbor', weight: PROSE_MENTION_WEIGHT }]],
    ]);

    const expanded = expandFirstHopCandidates(fused, 2, adjacency);
    const pairsEntry = expanded.find((e) => e.id === 'pairs-neighbor');
    const proseEntry = expanded.find((e) => e.id === 'prose-neighbor');
    expect(pairsEntry.fusedScore).toBeGreaterThan(proseEntry.fusedScore);
    expect(pairsEntry.via).toBe('first-hop');
    expect(pairsEntry.hopSeed).toBe('seed-pairs');
  });

  test('hop decay keeps a weak neighbor below a strong direct match', async () => {
    const { expandFirstHopCandidates, PAIRS_WITH_WEIGHT } = await import('../../lib/skill-graft.js');
    const fused = [
      { id: 'strong-direct', fusedScore: 0.033 }, // e.g. matched in both BM25 + Tool2Vec at rank 1
      { id: 'weak-seed', fusedScore: 0.005 },      // a weak but still-shortlisted direct match
    ];
    // Best-case edge weight (pairs-with) from the weak seed — even so, the
    // decay must keep it from beating a genuinely strong direct match.
    const adjacency = new Map([
      ['weak-seed', [{ target: 'weak-neighbor', weight: PAIRS_WITH_WEIGHT }]],
    ]);

    const expanded = expandFirstHopCandidates(fused, 2, adjacency);
    const strong = expanded.find((e) => e.id === 'strong-direct');
    const neighbor = expanded.find((e) => e.id === 'weak-neighbor');
    expect(neighbor.fusedScore).toBeLessThan(strong.fusedScore);
  });

  test('an id already in the fused list keeps max(own, boosted) and only gains provenance when the boost wins', async () => {
    const { expandFirstHopCandidates } = await import('../../lib/skill-graft.js');
    const fused = [
      { id: 'seed', fusedScore: 0.03 },
      { id: 'already-ranked-high', fusedScore: 0.029 }, // beats any possible boost
      { id: 'already-ranked-low', fusedScore: 0.0001 }, // loses to the boost
    ];
    const adjacency = new Map([
      ['seed', [
        { target: 'already-ranked-high', weight: 1.0 },
        { target: 'already-ranked-low', weight: 1.0 },
      ]],
    ]);

    const expanded = expandFirstHopCandidates(fused, 3, adjacency);
    const high = expanded.find((e) => e.id === 'already-ranked-high');
    const low = expanded.find((e) => e.id === 'already-ranked-low');
    expect(high.fusedScore).toBe(0.029); // own score wins — untouched
    expect(high.via).toBeUndefined(); // no boost applied — not first-hop provenance
    expect(low.fusedScore).toBeGreaterThan(0.0001); // boost wins over its tiny own score
    expect(low.via).toBe('first-hop');
    expect(low.hopSeed).toBe('seed');
  });

  test('an empty adjacency map returns the fused list untouched (no via field anywhere)', async () => {
    const { expandFirstHopCandidates } = await import('../../lib/skill-graft.js');
    const fused = [{ id: 'a', fusedScore: 0.02 }, { id: 'b', fusedScore: 0.01 }];
    const expanded = expandFirstHopCandidates(fused, 10, new Map());
    expect(expanded).toEqual(fused.map((e) => ({ id: e.id, fusedScore: e.fusedScore })));
    for (const entry of expanded) expect(entry.via).toBeUndefined();
  });

  test('a self-edge never boosts its own seed (belt-and-suspenders guard)', async () => {
    const { expandFirstHopCandidates, PAIRS_WITH_WEIGHT } = await import('../../lib/skill-graft.js');
    // The scanners already exclude a skill's own id, but the expansion guard
    // must hold even against a hand-built self-referential adjacency.
    const fused = [{ id: 'narcissus', fusedScore: 0.02 }];
    const adjacency = new Map([
      ['narcissus', [{ target: 'narcissus', weight: PAIRS_WITH_WEIGHT }]],
    ]);
    const expanded = expandFirstHopCandidates(fused, 1, adjacency);
    expect(expanded).toEqual([{ id: 'narcissus', fusedScore: 0.02 }]);
    expect(expanded[0].via).toBeUndefined();
  });

  test('duplicate edges from one seed to one target keep the higher-weight boost (max wins, never sums)', async () => {
    const { expandFirstHopCandidates, PAIRS_WITH_WEIGHT, PROSE_MENTION_WEIGHT, HOP_DECAY } =
      await import('../../lib/skill-graft.js');
    // A skill can both declare a pairs-with edge AND mention the same id in
    // prose — the boost must be the curated weight, never a sum of the two.
    const fused = [{ id: 'seed', fusedScore: 0.02 }];
    const adjacency = new Map([
      ['seed', [
        { target: 'neighbor', weight: PROSE_MENTION_WEIGHT },
        { target: 'neighbor', weight: PAIRS_WITH_WEIGHT },
      ]],
    ]);
    const expanded = expandFirstHopCandidates(fused, 1, adjacency);
    const neighbor = expanded.find((e) => e.id === 'neighbor');
    expect(neighbor.fusedScore).toBeCloseTo(0.02 * PAIRS_WITH_WEIGHT * HOP_DECAY, 10);
    expect(neighbor.via).toBe('first-hop');
    expect(neighbor.hopSeed).toBe('seed');
  });
});

describe('buildSkillAdjacency + first-hop expansion end-to-end through craft()', () => {
  test('a catalog with no pairs-with fields and no prose mentions builds an empty adjacency', async () => {
    const { buildSkillAdjacency } = await import('../../lib/skill-graft.js');
    writeSkill(tmpRoot, 'loner-one', 'entirely self-contained description alpha');
    writeSkill(tmpRoot, 'loner-two', 'another unconnected description beta');
    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    // Rebuild directly from the scanned entries the index holds: no curated
    // edges, no cross-mentions — the graph must be empty, which is what
    // makes the zero-degree byte-identical guarantee structural.
    const catalog = (await graft.craft('entirely self-contained description alpha')).shortlist;
    const adjacency = buildSkillAdjacency(
      catalog.map((e) => ({ id: e.id, description: e.description, sourcePath: join(tmpRoot, e.id, 'SKILL.md') })),
    );
    expect(adjacency.size).toBe(0);
  });

  test('a pairs-with frontmatter edge surfaces its target as a first-hop candidate with via/hopSeed provenance', async () => {
    writeSkill(tmpRoot, 'seed-skill', 'central topic words filler alpha', {
      pairsWith: ['paired-neighbor'],
    });
    // Deliberately zero lexical/semantic overlap with the query — the only
    // way this skill can appear is via the pairs-with hop edge.
    writeSkill(tmpRoot, 'paired-neighbor', 'a skill about completely unrelated vocabulary zebra giraffe');

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    const result = await graft.craft('central topic words filler alpha', { shortlistLimit: 5 });

    const neighbor = result.shortlist.find((e) => e.id === 'paired-neighbor');
    expect(neighbor).toBeDefined();
    expect(neighbor.via).toBe('first-hop');
    expect(neighbor.hopSeed).toBe('seed-skill');
    // The seed itself is a plain direct match — no provenance noise on it.
    const seed = result.shortlist.find((e) => e.id === 'seed-skill');
    expect(seed.via).toBeUndefined();
  });

  test('a pairs-with target that is not a real catalog skill never reaches the shortlist', async () => {
    // A typo'd or uninstalled pairs-with target honestly enters the
    // adjacency, but craft()'s merge drops any fused id with no catalog
    // entry (the `if (!skill) continue` guard) — ghosts cannot surface as
    // shortlist entries or spliced grafts.
    writeSkill(tmpRoot, 'ghost-seed', 'central topic words filler alpha', {
      pairsWith: ['this-skill-does-not-exist-anywhere'],
    });

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    const result = await graft.craft('central topic words filler alpha', { shortlistLimit: 5 });

    expect(result.shortlist.some((e) => e.id === 'this-skill-does-not-exist-anywhere')).toBe(false);
    expect(result.top.some((e) => e.id === 'this-skill-does-not-exist-anywhere')).toBe(false);
    // The seed with the dangling edge still ranks normally.
    expect(result.shortlist.some((e) => e.id === 'ghost-seed')).toBe(true);
  });

  test('a bare-string pairs-with entry (the wave-by-wave-parley shape) counts as a curated edge too', async () => {
    // 22 real SKILL.md files list `pairs-with` as plain id strings instead
    // of `{skill, reason}` objects (top-level in the imported windags
    // grafts, flow-style under metadata in several port-daddy-* skills) —
    // regression guard: both shapes must produce the same curated edge.
    const dir = join(tmpRoot, 'string-seed');
    mkdirSync(dir, { recursive: true });
    // A HYBRID list — one bare string, one {skill, reason} object — in the
    // same pairs-with array: entries are parsed independently, so mixed
    // shapes (which real catalogs drift into) must both produce edges.
    writeFileSync(join(dir, 'SKILL.md'),
      `---\nname: string-seed\ndescription: |\n  central topic words filler alpha\npairs-with:\n  - string-paired-neighbor\n  - skill: object-paired-neighbor\n    reason: object-shape entry in the same list\n---\n\n# string-seed\n`);
    writeSkill(tmpRoot, 'string-paired-neighbor', 'a skill about completely unrelated vocabulary zebra giraffe');
    writeSkill(tmpRoot, 'object-paired-neighbor', 'another skill about totally different vocabulary walrus penguin');

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    const result = await graft.craft('central topic words filler alpha', { shortlistLimit: 5 });

    const neighbor = result.shortlist.find((e) => e.id === 'string-paired-neighbor');
    expect(neighbor).toBeDefined();
    expect(neighbor.via).toBe('first-hop');
    expect(neighbor.hopSeed).toBe('string-seed');
    const objectNeighbor = result.shortlist.find((e) => e.id === 'object-paired-neighbor');
    expect(objectNeighbor).toBeDefined();
    expect(objectNeighbor.via).toBe('first-hop');
    expect(objectNeighbor.hopSeed).toBe('string-seed');
  });

  test('a prose-mention edge (hyphenated id inside SKILL.md body) also surfaces as first-hop provenance', async () => {
    writeSkill(tmpRoot, 'seed-alpha', 'central topic words filler alpha', {
      body: '# seed-alpha\n\nSee also mentioned-neighbor-skill for related work.',
    });
    writeSkill(tmpRoot, 'mentioned-neighbor-skill', 'a skill about completely unrelated vocabulary zebra giraffe');

    // Lexical-only (no synthetic-query generator/centroid store): Tool2Vec
    // ranks EVERY cached skill with SOME cosine similarity, never a hard
    // zero, so on a two-skill catalog it would put mentioned-neighbor-skill
    // in the directly-fused list regardless of the hop edge and mask what
    // this test is actually proving. BM25 has a real zero-score cutoff, so
    // in lexical-only mode the target can only appear via the prose-mention
    // edge.
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder: makeMockEmbedder(),
    });
    const result = await graft.craft('central topic words filler alpha', { shortlistLimit: 5 });

    const neighbor = result.shortlist.find((e) => e.id === 'mentioned-neighbor-skill');
    expect(neighbor).toBeDefined();
    expect(neighbor.via).toBe('first-hop');
    expect(neighbor.hopSeed).toBe('seed-alpha');
  });

  test('a non-hyphenated id is never treated as a prose mention (common-word false-positive guard)', async () => {
    writeSkill(tmpRoot, 'seed-common-word', 'central topic words filler alpha', {
      // "liaison" is a real single-word (no-hyphen) skill id in this repo's
      // own catalog — exactly the common-word case the hyphen guard exists
      // for. It shows up here in ordinary sentence prose, not as a deliberate
      // reference.
      body: '# seed-common-word\n\nOur liaison for this topic is out this week.',
    });
    // Deliberately no "word"/"words" (or any other query-stem) anywhere in
    // this description — a coincidental BM25 hit would defeat the point of
    // isolating the hop-edge behavior.
    writeSkill(tmpRoot, 'liaison', 'an unrelated skill about greenhouse irrigation scheduling');

    // Lexical-only, for the same reason as the prose-mention test above:
    // isolates "did the hop edge fire" from Tool2Vec's always-nonzero
    // similarity noise on a tiny catalog.
    const graft = createSkillGraftIndex({
      roots: [{ label: 'test', path: tmpRoot }],
      embedder: makeMockEmbedder(),
    });
    const result = await graft.craft('central topic words filler alpha', { shortlistLimit: 5 });

    const neighbor = result.shortlist.find((e) => e.id === 'liaison');
    expect(neighbor).toBeUndefined(); // no hyphen in id → never scanned as a prose-mention target
  });

  test('caps stay unchanged: shortlist length never exceeds shortlistLimit even when hop-expansion adds many candidates', async () => {
    // One strong seed fans out via pairs-with to far more skills than the
    // shortlist limit allows.
    const neighborIds = Array.from({ length: 8 }, (_, i) => `hop-neighbor-${i}`);
    writeSkill(tmpRoot, 'hub-skill', 'central topic words filler content alpha', { pairsWith: neighborIds });
    for (const id of neighborIds) writeSkill(tmpRoot, id, 'a skill about completely unrelated vocabulary zebra');
    writeSkill(tmpRoot, 'other-skill', 'central topic words filler content beta');

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    const result = await graft.craft('central topic words filler content', { shortlistLimit: 3 });

    expect(result.shortlist.length).toBeLessThanOrEqual(3); // cap held despite 8 fanned-out neighbors
  });

  test('a zero-degree skill (no pairs-with, no prose mentions) ranks identically to the pre-expansion shortlist', async () => {
    // Same fixture as the very first craft() test above — none of these
    // bodies/frontmatter mention another skill's id or declare pairs-with,
    // so the first-hop graph contributes nothing for any of them.
    writeSkill(tmpRoot, 'duckdb-analytics', 'analytical SQL over parquet csv json duckdb olap columnar', { category: 'Data' });
    writeSkill(tmpRoot, 'oauth2-and-oidc-from-scratch', 'oauth2 oidc pkce authorization code flow token refresh', { category: 'Auth' });
    writeSkill(tmpRoot, 'rag-retrieval-pattern-design', 'rag retrieval chunking hybrid bm25 dense reranking ragas', { category: 'AI' });

    const graft = makeGraftIndex(tmpRoot);
    await graft.refresh();
    const result = await graft.craft('parquet columnar olap analytics duckdb');

    expect(result.scannedCount).toBe(3);
    expect(result.shortlist).toHaveLength(3);
    expect(result.shortlist[0].id).toBe('duckdb-analytics');
    expect(result.shortlist[0].similarity).toBeGreaterThan(result.shortlist[1].similarity);
    // No hop expansion touched any entry — byte-identical to the
    // pre-expansion shape: no `via` key on any shortlist entry at all.
    for (const entry of result.shortlist) {
      expect(entry.via).toBeUndefined();
      expect(entry.hopSeed).toBeUndefined();
    }
  });
});

// ─── computeCentroid + getOrBuildCentroid (lib/skill-graft-tool2vec.ts) ────

describe('computeCentroid', () => {
  test('averages normalized vectors and re-normalizes the result', () => {
    const centroid = computeCentroid([[1, 0], [0, 1]]);
    const norm = Math.sqrt(centroid.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test('empty input returns an empty vector', () => {
    expect(computeCentroid([])).toEqual([]);
  });
});

describe('getOrBuildCentroid', () => {
  test('a generator returning zero usable queries yields null, not a throw', async () => {
    const store = createTool2VecStore({ db: new Database(':memory:'), embedderModelId: 'mock', generatorId: 'empty-gen' });
    const skill = { id: 'x', name: 'x', description: 'desc', category: '', tags: [], sourcePath: '/x/SKILL.md', contentHash: 'h1' };
    const entry = await getOrBuildCentroid(skill, store, makeMockEmbedder(), async () => []);
    expect(entry).toBeNull();
  });

  test('a second call for the same (id, contentHash) is served from the store, not regenerated', async () => {
    const store = createTool2VecStore({ db: new Database(':memory:'), embedderModelId: 'mock/test-embedder', generatorId: 'gen' });
    const skill = { id: 'y', name: 'y', description: 'desc', category: '', tags: [], sourcePath: '/y/SKILL.md', contentHash: 'h1' };
    let calls = 0;
    const generator = async () => { calls += 1; return ['a task', 'another task']; };
    await getOrBuildCentroid(skill, store, makeMockEmbedder(), generator);
    await getOrBuildCentroid(skill, store, makeMockEmbedder(), generator);
    expect(calls).toBe(1);
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

  test('labels BM25-only entries as a lexical match instead of a misleading similarity 0.00', () => {
    const text = renderSkillGraftContext({
      query: 'hybrid retrieval',
      scannedCount: 42,
      roots: [],
      // similarity 0 == the semantic tier didn't score this entry (whole
      // lexical-only tier, or a hybrid entry BM25 surfaced but semantic didn't).
      shortlist: [
        { id: 'duckdb-analytics', description: 'Analytical SQL over parquet', category: 'Data', tags: [], similarity: 0 },
        { id: 'rag-retrieval-pattern-design', description: 'RAG chunking and hybrid search', category: 'AI', tags: [], similarity: 0.83 },
      ],
      top: [],
      semanticTier: 'lexical-only',
    });

    expect(text).toContain('duckdb-analytics (lexical match)');
    expect(text).not.toContain('similarity 0.00');
    // A genuinely scored entry still shows its real similarity.
    expect(text).toContain('rag-retrieval-pattern-design (similarity 0.83)');
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
      // No generateSyntheticQueries/centroidStore injected — this test only
      // proves the scanner/frontmatter parser survives every real SKILL.md,
      // so it deliberately runs in lexical-only mode (no embedding/LLM work
      // at all) rather than paying to build ~292 Tool2Vec centroids.
    });

    const stats = await graft.refresh();
    expect(stats.scannedCount).toBeGreaterThan(100);
    expect(stats.embedded).toBe(0); // no generator configured — scan-only

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
