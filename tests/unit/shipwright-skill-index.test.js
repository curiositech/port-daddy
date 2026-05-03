// Shipwright Skill Index — verifies catalog walking, embedding, persistence,
// and cosine retrieval against a deterministic mock embedder. The real
// MiniLM loader is private to the module; tests inject `embedder` so we
// never touch @huggingface/transformers in CI.

import { jest } from '@jest/globals';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const { createSkillIndex, loadSkillCatalog } = await import('../../lib/shipwright/skill-index.js');

// Bag-of-words embedder: 64-D, each word hashes to a bucket. Overlapping
// vocabulary → similar vectors. Good enough for ranking assertions without
// a real model. L2-normalized so cosine === dot product.
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

let tmpRoot;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pd-skill-index-test-'));
});

afterEach(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

function makeDb() {
  return new Database(':memory:');
}

function writeSkill(rootDir, name, description, opts = {}) {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  const tags = Array.isArray(opts.tags) ? `\n    - ${opts.tags.join('\n    - ')}` : '';
  const category = opts.category ? `category: ${opts.category}` : '';
  const fm = `---\nname: ${name}\ndescription: |\n  ${description}\nmetadata:\n  ${category}\n  tags:${tags}\n---\n\n# ${name}\n`;
  writeFileSync(join(dir, 'SKILL.md'), fm);
  return join(dir, 'SKILL.md');
}

test('loadSkillCatalog walks roots, parses frontmatter, dedupes by id', () => {
  writeSkill(tmpRoot, 'qa-helper', 'runs the test suite and triages failures', { category: 'Testing', tags: ['tests', 'ci'] });
  writeSkill(tmpRoot, 'doc-syncer', 'detects drift between code and README', { category: 'Docs', tags: ['docs'] });

  const skills = loadSkillCatalog([tmpRoot]);
  expect(skills).toHaveLength(2);
  const qa = skills.find((s) => s.id === 'qa-helper');
  expect(qa).toBeDefined();
  expect(qa.description).toContain('test suite');
  expect(qa.category).toBe('Testing');
  expect(qa.tags).toEqual(['tests', 'ci']);
  expect(qa.contentHash).toMatch(/^[a-f0-9]{16}$/);
});

test('loadSkillCatalog skips files without name or description, never throws', () => {
  const dir = join(tmpRoot, 'broken');
  mkdirSync(dir);
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: only-name\n---\n');

  const warnings = [];
  const skills = loadSkillCatalog([tmpRoot], { onWarning: (m) => warnings.push(m) });
  expect(skills).toHaveLength(0);
  expect(warnings.length).toBeGreaterThan(0);
  expect(warnings[0]).toMatch(/missing name or description/);
});

test('index() embeds new skills and reuses cached ones by content hash', async () => {
  writeSkill(tmpRoot, 'alpha', 'first skill description');
  writeSkill(tmpRoot, 'beta', 'second skill description');
  const skills = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  const first = await idx.index(skills);
  expect(first).toEqual({ embedded: 2, reused: 0, removed: 0 });

  const second = await idx.index(skills);
  expect(second).toEqual({ embedded: 0, reused: 2, removed: 0 });
});

test('index() removes skills no longer in the catalog', async () => {
  writeSkill(tmpRoot, 'alpha', 'alpha description');
  writeSkill(tmpRoot, 'beta', 'beta description');
  const initial = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  await idx.index(initial);

  // Drop beta from the catalog by re-walking only alpha's skill file.
  const onlyAlpha = initial.filter((s) => s.id === 'alpha');
  const result = await idx.index(onlyAlpha);
  expect(result).toEqual({ embedded: 0, reused: 1, removed: 1 });

  const stillThere = idx.db.prepare('SELECT skill_id FROM shipwright_skill_vectors').all();
  expect(stillThere.map((r) => r.skill_id)).toEqual(['alpha']);
});

test('index() re-embeds when description changes (contentHash invalidation)', async () => {
  writeSkill(tmpRoot, 'gamma', 'original description');
  const initial = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  await idx.index(initial);

  // Rewrite SKILL.md with a different description → new content hash.
  writeSkill(tmpRoot, 'gamma', 'completely revised description');
  const updated = loadSkillCatalog([tmpRoot]);
  const result = await idx.index(updated);
  expect(result).toEqual({ embedded: 1, reused: 0, removed: 0 });
});

test('search() returns top-k by cosine, descending', async () => {
  // Use real-world descriptions whose content overlaps differently with the query.
  writeSkill(tmpRoot, 'tester', 'run the test suite and report failures clearly');
  writeSkill(tmpRoot, 'doc-bot', 'detect drift between source code and documentation');
  writeSkill(tmpRoot, 'cleanup', 'remove dead code, deprecated APIs, and unused imports');
  const skills = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  await idx.index(skills);

  const results = await idx.search('detect drift between code and documentation', { k: 2 });
  expect(results).toHaveLength(2);
  // Descending order
  expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
  // Top hit should be doc-bot for this query
  expect(results[0].skill.id).toBe('doc-bot');
});

test('search() honors preferred boost for tie-breaking', async () => {
  writeSkill(tmpRoot, 'aaaaa', 'identical description text');
  writeSkill(tmpRoot, 'bbbbb', 'identical description text');
  const skills = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  await idx.index(skills);

  const noBoost = await idx.search('identical', { k: 2 });
  expect(noBoost.map((r) => r.skill.id).sort()).toEqual(['aaaaa', 'bbbbb']);

  const withBoost = await idx.search('identical', { k: 2, preferred: ['bbbbb'], preferredBoost: 0.1 });
  expect(withBoost[0].skill.id).toBe('bbbbb');
});

test('clear() drops every persisted vector', async () => {
  writeSkill(tmpRoot, 'alpha', 'alpha description');
  const skills = loadSkillCatalog([tmpRoot]);

  const idx = createSkillIndex({ db: makeDb(), embedder: makeMockEmbedder() });
  await idx.index(skills);
  expect(idx.db.prepare('SELECT COUNT(*) as c FROM shipwright_skill_vectors').get().c).toBe(1);

  idx.clear();
  expect(idx.db.prepare('SELECT COUNT(*) as c FROM shipwright_skill_vectors').get().c).toBe(0);
});
