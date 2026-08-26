/**
 * Skill Graft — Tool2Vec synthetic-query centroid stage.
 *
 * THE BUG THIS FIXES: the original skill-graft ranker embedded a skill's
 * OWN description text and compared it by cosine to the incoming task's
 * embedding. A task phrased in user/action language ("fix a memory leak in
 * the daemon") often has low cosine similarity to a skill's own description
 * phrased in different vocabulary ("detects unbounded heap growth via
 * snapshot diffing") even when the skill is exactly right — comparing a
 * shovel to a bonsai tree. Both sides need to live in the SAME semantic
 * space (task-intent space) for cosine to mean anything.
 *
 * THE FIX (Tool2Vec, see https://windags.ai/blog/the-skill-matching-cascade):
 * for each skill, generate ~15 diverse synthetic task descriptions — the
 * kind of thing a user would actually type that this skill should answer —
 * via one cheap LLM call, embed each with the shared local embedder, and
 * average them into a single centroid vector. The incoming task is compared
 * against these synthetic-query centroids, not the skill's own description.
 * Both sides are now "what would you use this for," not "what is this."
 *
 * Centroids are cached content-hash-keyed (skill id + SKILL.md content
 * hash, `SkillEntry.contentHash` — the same hash `shipwright/skill-index.ts`
 * already computes over name+description+category+tags) so the LLM call
 * happens once per skill and only again when that skill's frontmatter
 * changes — the same discipline Tool2Vec itself uses ("~$0.50 one-time...
 * cached indefinitely").
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseInstance } from './sqlite-runtime.js';
import DefaultDatabase from './sqlite-runtime.js';
import { cosineSimilarity } from './semantic-resolver.js';
import type { SkillEntry, SkillEmbedder } from './shipwright/skill-index.js';
import type { LLMClient } from './llm-call.js';

/** Number of synthetic task descriptions generated per skill. Matches the
 *  windags Tool2Vec reference (15) — enough diversity to average out any
 *  one query's idiosyncratic phrasing without being expensive to generate
 *  or embed. */
export const SYNTHETIC_QUERIES_PER_SKILL = 15;

/** Pluggable synthetic-query generator. Production default wraps an
 *  `LLMClient` (see `createLLMClientSyntheticQueryGenerator`); tests inject
 *  a deterministic function directly so the centroid math is exercised
 *  without any network or LLM mocking. */
export type SyntheticQueryGenerator = (skill: SkillEntry, count: number) => Promise<string[]>;

export interface Tool2VecCentroidEntry {
  skillId: string;
  /** L2-normalized centroid — the mean of the (normalized) synthetic query
   *  embeddings, re-normalized so cosine comparison stays well-defined. */
  centroid: number[];
  /** The synthetic queries that produced this centroid — kept for operator
   *  inspection/debugging (`pd shipwright` style transparency), not read
   *  back by the ranker itself. */
  queries: string[];
}

export interface Tool2VecStoreOptions {
  /** Where to persist centroids. Defaults to a dedicated file distinct
   *  from Shipwright's own `skill-index.sqlite` — Tool2Vec's cache
   *  lifecycle (invalidated by SKILL.md content hash, keyed to the
   *  embedder + generator model) is independent of Shipwright's, and
   *  a shared file would couple two caches that reset on different
   *  schedules for different reasons. */
  db?: DatabaseInstance;
  dbDir?: string;
  /** Tags the cache row with the embedder's model id so switching
   *  embedding models doesn't silently reuse stale-dimension vectors. */
  embedderModelId: string;
  /** Tags the cache row with the generator's identity (e.g. the LLM model
   *  id, or 'injected-test-generator') for the same reason. */
  generatorId: string;
}

export interface Tool2VecStore {
  /** Return the cached centroid for (skillId, contentHash) if the model
   *  IDs match, else null (cache miss — caller must (re)generate). */
  get(skillId: string, contentHash: string): Tool2VecCentroidEntry | null;
  /** Persist a freshly-computed centroid. */
  put(skillId: string, contentHash: string, entry: Tool2VecCentroidEntry): void;
  /** Drop rows for skill ids no longer present in the catalog. Returns the
   *  count removed so callers can report it in refresh stats. */
  prune(liveSkillIds: readonly string[]): number;
  /** Inspect current-hash coverage without generating anything. Explicit
   *  model ids let Doctor inspect a cache built by an earlier daemon even
   *  when this CLI process does not currently have a generator configured. */
  coverage(
    skills: readonly Pick<SkillEntry, 'id' | 'contentHash'>[],
    expected?: { embedderModelId?: string; generatorId?: string },
  ): { current: number; missing: number; stale: number; total: number };
  db: DatabaseInstance;
}

const DEFAULT_DB_DIR = join(homedir(), '.port-daddy');
const DEFAULT_DB_FILE = 'skill-graft-tool2vec.sqlite';

function ensureSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_graft_tool2vec_centroids (
      skill_id            TEXT NOT NULL,
      content_hash        TEXT NOT NULL,
      embedder_model_id   TEXT NOT NULL,
      generator_id        TEXT NOT NULL,
      centroid_json       TEXT NOT NULL,
      queries_json        TEXT NOT NULL,
      created_at          INTEGER NOT NULL,
      PRIMARY KEY (skill_id)
    );
  `);
}

function openDefaultDb(dbDir?: string): DatabaseInstance {
  const dir = dbDir ?? DEFAULT_DB_DIR;
  mkdirSync(dir, { recursive: true });
  return new DefaultDatabase(join(dir, DEFAULT_DB_FILE));
}

/**
 * Build (or open) the Tool2Vec centroid cache. Tests inject `db: new
 * Database(':memory:')` (mirroring `createSkillIndex({ db })`'s pattern)
 * so no file touches disk during Jest runs.
 */
export function createTool2VecStore(options: Tool2VecStoreOptions): Tool2VecStore {
  const db = options.db ?? openDefaultDb(options.dbDir);
  ensureSchema(db);

  const getStmt = db.prepare(`
    SELECT content_hash, embedder_model_id, generator_id, centroid_json, queries_json
    FROM skill_graft_tool2vec_centroids
    WHERE skill_id = ?
  `);
  const upsertStmt = db.prepare(`
    INSERT INTO skill_graft_tool2vec_centroids
      (skill_id, content_hash, embedder_model_id, generator_id, centroid_json, queries_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(skill_id) DO UPDATE SET
      content_hash = excluded.content_hash,
      embedder_model_id = excluded.embedder_model_id,
      generator_id = excluded.generator_id,
      centroid_json = excluded.centroid_json,
      queries_json = excluded.queries_json,
      created_at = excluded.created_at
  `);
  const inspectStmt = db.prepare(`
    SELECT content_hash, embedder_model_id, generator_id
    FROM skill_graft_tool2vec_centroids
    WHERE skill_id = ?
  `);

  return {
    db,

    get(skillId, contentHash) {
      const row = getStmt.get(skillId) as {
        content_hash: string;
        embedder_model_id: string;
        generator_id: string;
        centroid_json: string;
        queries_json: string;
      } | undefined;
      if (!row) return null;
      // A stale row (different SKILL.md content, different embedder, or a
      // different generator) is a miss, not a partial hit — mixing
      // centroids computed under different models would silently corrupt
      // the similarity scale.
      if (row.content_hash !== contentHash) return null;
      if (row.embedder_model_id !== options.embedderModelId) return null;
      if (row.generator_id !== options.generatorId) return null;
      try {
        return {
          skillId,
          centroid: JSON.parse(row.centroid_json) as number[],
          queries: JSON.parse(row.queries_json) as string[],
        };
      } catch {
        return null;
      }
    },

    put(skillId, contentHash, entry) {
      upsertStmt.run(
        skillId,
        contentHash,
        options.embedderModelId,
        options.generatorId,
        JSON.stringify(entry.centroid),
        JSON.stringify(entry.queries),
        Date.now(),
      );
    },

    prune(liveSkillIds) {
      const live = new Set(liveSkillIds);
      const rows = db.prepare('SELECT skill_id FROM skill_graft_tool2vec_centroids').all() as Array<{ skill_id: string }>;
      const del = db.prepare('DELETE FROM skill_graft_tool2vec_centroids WHERE skill_id = ?');
      const tx = db.transaction((ids: string[]) => { for (const id of ids) del.run(id); });
      const stale = rows.map((r) => r.skill_id).filter((id) => !live.has(id));
      if (stale.length > 0) tx(stale);
      return stale.length;
    },

    /**
     * Counts missing, stale, and current rows without generation. The purpose
     * is a cheap status projection whose expected model identities are explicit
     * even when the inspecting process has no active generator.
     *
     * @param skills Current catalog ids and content hashes.
     * @param expected Optional embedder and generator identities to compare.
     * @returns Exact current, missing, stale, and total row counts.
     */
    coverage(skills, expected = {}) {
      const embedderModelId = expected.embedderModelId ?? options.embedderModelId;
      const generatorId = expected.generatorId ?? options.generatorId;
      let current = 0;
      let missing = 0;
      let stale = 0;
      for (const skill of skills) {
        const row = inspectStmt.get(skill.id) as {
          content_hash: string;
          embedder_model_id: string;
          generator_id: string;
        } | undefined;
        if (!row) {
          missing++;
          continue;
        }
        if (
          row.content_hash === skill.contentHash &&
          row.embedder_model_id === embedderModelId &&
          row.generator_id === generatorId
        ) {
          current++;
        } else {
          stale++;
        }
      }
      return { current, missing, stale, total: skills.length };
    },
  };
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** Average a set of L2-normalized vectors and re-normalize the result —
 *  the Tool2Vec centroid. Re-normalizing matters: the mean of unit vectors
 *  is not itself unit length, and downstream cosine comparisons assume
 *  normalized inputs (same assumption `semantic-resolver.ts` documents). */
export function computeCentroid(vectors: readonly number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += vec[i] ?? 0;
  }
  const mean = sum.map((v) => v / vectors.length);
  return normalize(mean);
}

/**
 * Get a skill's Tool2Vec centroid, generating + caching it on a miss.
 * Never throws on a generator failure that returns zero usable queries —
 * returns null so the caller can skip the semantic tier for that one skill
 * rather than aborting the whole ranking pass.
 */
export async function getOrBuildCentroid(
  skill: SkillEntry,
  store: Tool2VecStore,
  embedder: Pick<SkillEmbedder, 'embed'>,
  generateQueries: SyntheticQueryGenerator,
): Promise<Tool2VecCentroidEntry | null> {
  const cached = store.get(skill.id, skill.contentHash);
  if (cached) return cached;

  const rawQueries = await generateQueries(skill, SYNTHETIC_QUERIES_PER_SKILL);
  const queries = rawQueries.map((q) => q.trim()).filter(Boolean);
  if (queries.length === 0) return null;

  const vectors = await embedder.embed(queries);
  const normalized = vectors.filter((v) => v.length > 0).map(normalize);
  if (normalized.length === 0) return null;

  const entry: Tool2VecCentroidEntry = {
    skillId: skill.id,
    centroid: computeCentroid(normalized),
    queries,
  };
  store.put(skill.id, skill.contentHash, entry);
  return entry;
}

export interface Tool2VecRankedEntry {
  id: string;
  similarity: number;
}

/**
 * Rank every skill by cosine similarity between the query embedding and
 * each skill's ALREADY-CACHED Tool2Vec centroid (NOT its description
 * embedding — that's the bug this module exists to avoid reintroducing).
 * Read-only and synchronous-fast (one SQLite read per skill, no LLM/embed
 * calls) — building centroids is `ensureIndexed()`'s job in
 * `lib/skill-graft.ts`, run once before ranking so a `craft()` call never
 * pays a per-query LLM cost. A skill with no cached centroid (generator
 * never configured, or its generation failed) is silently excluded from
 * the semantic ranking — it still gets a chance via BM25.
 */
export function tool2VecRank(
  queryVector: readonly number[],
  skills: readonly SkillEntry[],
  store: Tool2VecStore,
): Tool2VecRankedEntry[] {
  const results: Tool2VecRankedEntry[] = [];
  for (const skill of skills) {
    const entry = store.get(skill.id, skill.contentHash);
    if (!entry) continue;
    results.push({ id: skill.id, similarity: cosineSimilarity(queryVector as number[], entry.centroid) });
  }
  return results.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
}

// ─── Default LLM-backed generator ───────────────────────────────────────────

const SYNTHETIC_QUERY_PROMPT = `You generate training data for a skill-matching system.

Skill name: {name}
Skill description: {description}
Skill category: {category}

Write {count} diverse, realistic task descriptions a user might type to an AI coding agent that this skill should handle. Phrase them the way a REAL USER would ask — casual, in-the-moment, action-oriented (e.g. "fix a memory leak in the daemon", NOT "detects unbounded heap growth via snapshot diffing"). Vary the phrasing, the framing (bug report / feature request / question), and the vocabulary across the {count} — do not just reword the skill description.

Return strict JSON: {"queries": ["...", "...", ...]} with exactly {count} strings, no prose, no markdown fences.`;

function buildPrompt(skill: SkillEntry, count: number): string {
  return SYNTHETIC_QUERY_PROMPT
    .replace(/\{name\}/g, skill.name)
    .replace(/\{description\}/g, skill.description)
    .replace(/\{category\}/g, skill.category || '(uncategorized)')
    .replace(/\{count\}/g, String(count));
}

function parseQueriesResponse(text: string, count: number): string[] {
  const trimmed = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed.slice(start, end + 1)); } catch { return []; }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const queries = (parsed as Record<string, unknown>).queries;
  if (!Array.isArray(queries)) return [];
  return queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).slice(0, count);
}

/**
 * Default synthetic-query generator: wraps an `LLMClient` (the same
 * request-shape client `lib/shipwright/survey.ts`'s `callIntentLLM` and
 * `lib/coordination-judge.ts` use — cache/rate-limit/timeout already
 * handled by `createLLMClient`) with the Tool2Vec prompt above. Content-hash
 * scoped cache key so re-generating for an unchanged skill is a cache hit
 * even across process restarts (when the injected client shares a
 * persistent cache — the default in-memory client does not, but the
 * centroid store above is the durable cache that actually matters here).
 *
 * @example
 *   const generate = createLLMClientSyntheticQueryGenerator(client, 'claude-haiku-4-5-20251001');
 *   const queries = await generate(skill, 15);
 *   // → ["fix a memory leak in the daemon", "why does my process keep growing in RSS", ...]
 */
export function createLLMClientSyntheticQueryGenerator(client: LLMClient, model: string): SyntheticQueryGenerator {
  return async (skill, count) => {
    const prompt = buildPrompt(skill, count);
    // `count` is part of the key: a cache hit for count=5 must never be
    // replayed for a later count=15 call on the same skill — the client's
    // semantic/exact cache has no idea "15 queries" and "5 queries" are
    // different-shaped results for the same underlying prompt family.
    const cacheKey = `skill-graft-tool2vec:${skill.id}:${skill.contentHash}:${model}:${count}`;
    const result = await client.complete({ prompt, model, maxTokens: 1200, cacheKey });
    if (!result.ok || !result.text) return [];
    return parseQueriesResponse(result.text, count);
  };
}
