/**
 * Shipwright Skill Index
 *
 * Embeds skill catalog entries into a SQLite-backed vector index that
 * Shipwright queries during `propose` to attach the right skills to each
 * proposed agent. Reuses the same Transformers.js MiniLM encoder
 * `lib/semantic-resolver.ts` already pays the cost for, so first invocation
 * downloads the model (~80MB) and subsequent runs hit the FS cache.
 *
 * Why a dedicated index (not the existing semantic_resolutions table):
 * - Different scope: skill catalog is mostly read, occasionally re-indexed
 *   when SKILL.md content changes. Semantic resolutions are append-only
 *   per-event records. Mixing them would mean every cosine query scans
 *   every resolution event.
 * - Different lifecycle: skill index lives at `~/.port-daddy/skill-index.sqlite`
 *   (the path `docs/shipwright/README.md` names) so it survives
 *   `pd reset --db`, which the operator may want for the main DB.
 *
 * Embedding only the `description` field, not the prompt template body —
 * descriptions are already curated for retrieval.
 */

import Database, { type DatabaseInstance } from '../sqlite-runtime.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DEFAULT_SEMANTIC_MODEL_ID, ensureOnnxRuntimeNativeLibFindable } from '../semantic-resolver.js';

/**
 * Visibility tier a skill has opted into, from frontmatter `visibility`.
 *
 * These skills are not a distributed catalog — they're one operator's, scoped to their own
 * repos. `'private'` (the default) means nothing beyond that: no export path, no directory
 * listing, no publish target ever sees the entry. `'listed'` and `'public'` are each a
 * deliberate, per-skill opt-in a person wrote into their own SKILL.md — never a tier a parser
 * infers or a default anyone lands in by omission.
 */
export type SkillVisibility = 'private' | 'listed' | 'public';

/** One skill entry as parsed from a SKILL.md frontmatter. */
export interface SkillEntry {
  /** Stable ID — the skill `name` from frontmatter. */
  id: string;
  /** Absolute path to the SKILL.md file. */
  sourcePath: string;
  /** Display name from frontmatter. Falls back to `id`. */
  name: string;
  /** Long-form description used as the embedding source. */
  description: string;
  /** Category from frontmatter `metadata.category`. Empty when absent. */
  category: string;
  /** Tags from frontmatter `metadata.tags`. Empty when absent. */
  tags: string[];
  /**
   * Owner (a person) from frontmatter `owner`. `undefined` when the frontmatter doesn't declare
   * one — that's not "unowned" or fair game to surface, it's just a `private`-tier skill with no
   * attribution recorded. Never treat an undefined owner as license to widen visibility.
   */
  owner?: string;
  /** Repos this skill is scoped to, from frontmatter `repos`. Empty when not declared. */
  repos: string[];
  /**
   * The visibility tier this entry parsed to. Always populated — absent or malformed
   * frontmatter resolves to `'private'` (see `parseVisibility`), never left blank and never
   * widened by inference. Read this field yourself only for display; any code deciding whether
   * to actually show/export/publish a skill to someone besides its owner must go through
   * `isPublishableSkill` instead of comparing this directly.
   */
  visibility: SkillVisibility;
  /** Stable hash over (name + description + category + tags) for cache invalidation. */
  contentHash: string;
}

/**
 * The single predicate any future export, publish, or directory-listing path MUST call before
 * showing a skill entry to anyone beyond its owner's own machine and repos. Never gate a
 * publish path on `entry.visibility` directly — route it through here so the widening logic
 * lives in exactly one place.
 *
 * Two tiers, two payloads (the derived-index consent doctrine — see
 * `skills/local-first-tenancy-boundary`'s scope-ladder: private -> repo -> team -> public,
 * where silent tier crossing is always a critical finding, never a shrug):
 *
 * - `tier: 'listed'` authorizes the *smaller* payload — name + description only, the kind of
 *   thing a directory or search result shows. Satisfied by `visibility` `'listed'` OR
 *   `'public'` (public implies listed).
 * - `tier: 'public'` authorizes the *larger* payload — the full SKILL.md body. Satisfied only
 *   by `visibility === 'public'`.
 *
 * Pure and total: decides from the entry's already-parsed `visibility` alone, never reads disk,
 * never throws.
 *
 * @example
 *   const listable = catalog.filter((s) => isPublishableSkill(s, 'listed'));
 *   const fullBodyOk = isPublishableSkill(entry, 'public');
 */
export function isPublishableSkill(entry: Pick<SkillEntry, 'visibility'>, tier: 'listed' | 'public'): boolean {
  if (tier === 'public') return entry.visibility === 'public';
  // Only the exact 'listed' tier earns listed-tier semantics. TS can't stop
  // a plain-JS caller (or a typo'd cast) from passing some other string, and
  // falling through to the listed branch would hand that unknown tier the
  // WIDER grant — a listed skill's payload served for a tier nobody defined.
  // Unknown narrows, never widens (same law parseVisibility follows).
  if (tier !== 'listed') return false;
  return entry.visibility === 'listed' || entry.visibility === 'public';
}

/** One search result: a skill plus its cosine similarity to the query. */
export interface SkillSearchResult {
  skill: SkillEntry;
  similarity: number;
}

/** Embedder contract — kept narrow so tests can inject a deterministic mock. */
export interface SkillEmbedder {
  /** Stable model ID for cache-key purposes. */
  modelId: string;
  /** Returns L2-normalized vectors for the given texts. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Options for `createSkillIndex`. All have sensible defaults. */
export interface SkillIndexOptions {
  /** Database to persist vectors in. Defaults to `<dbDir>/skill-index.sqlite`. */
  db?: DatabaseInstance;
  /** Where to write the SQLite file when `db` is omitted. */
  dbDir?: string;
  /** Embedder to use. Defaults to the lazy MiniLM loader. */
  embedder?: SkillEmbedder;
  /** Where Transformers.js caches model artifacts. Defaults to `~/.port-daddy/transformers-cache`. */
  cacheDir?: string;
  /** Embedding model ID. Override only for tests or experiments. */
  modelId?: string;
  /** Logger hook for telemetry. No-op by default. */
  onProgress?: (event: { phase: 'embed-batch'; index: number; total: number }) => void;
}

/** Public surface returned by `createSkillIndex`. */
export interface SkillIndex {
  /**
   * Persist embeddings for a catalog. Re-embeds only entries whose
   * `contentHash` differs from the stored one. Returns counts so callers
   * can log the work done.
   */
  index(skills: readonly SkillEntry[]): Promise<{ embedded: number; reused: number; removed: number }>;

  /**
   * Top-k cosine matches for a query string. Boosts entries in
   * `preferred` by adding `preferredBoost` to their similarity score
   * (default 0.05) — small enough not to override a much better
   * match, large enough to break ties.
   */
  search(query: string, options?: { k?: number; preferred?: readonly string[]; preferredBoost?: number }): Promise<SkillSearchResult[]>;

  /** Drop every persisted vector. Useful for `--refresh` flows and tests. */
  clear(): void;

  /** Underlying database — exposed for tests + diagnostics, not for routine use. */
  db: DatabaseInstance;
}

const SKILL_DIR_BLOCKLIST = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.cache', '.scratch']);

/**
 * Walk one or more roots and collect every SKILL.md (case-insensitive).
 * Reads the YAML frontmatter and returns one `SkillEntry` per file. Files
 * with malformed frontmatter or no `name`/`description` are skipped with a
 * warning callback (when provided) — never thrown, so a single bad SKILL.md
 * doesn't poison a `pd shipwright propose` run.
 *
 * @example
 *   const skills = loadSkillCatalog([
 *     '/Users/me/coding/port-daddy/skills',
 *     '/Users/me/.claude/skills',
 *   ]);
 *   // → 150 entries deduped by id (later root wins on collision)
 */
export function loadSkillCatalog(
  roots: readonly string[],
  options: { onWarning?: (msg: string) => void } = {},
): SkillEntry[] {
  const seen = new Map<string, SkillEntry>();
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    walkSkillDir(root, seen, options.onWarning);
  }
  return [...seen.values()];
}

function walkSkillDir(dir: string, sink: Map<string, SkillEntry>, onWarning?: (msg: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKILL_DIR_BLOCKLIST.has(entry) || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let stats;
    try { stats = statSync(full); } catch { continue; }
    if (stats.isDirectory()) {
      walkSkillDir(full, sink, onWarning);
      continue;
    }
    if (!/^skill\.md$/i.test(entry)) continue;
    const parsed = parseSkillMd(full, onWarning);
    if (parsed) sink.set(parsed.id, parsed);
  }
}

function parseSkillMd(path: string, onWarning?: (msg: string) => void): SkillEntry | null {
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return null; }
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    onWarning?.(`Skipping ${path}: no YAML frontmatter`);
    return null;
  }
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseYaml(match[1]) as Record<string, unknown>;
  } catch (err) {
    onWarning?.(`Skipping ${path}: malformed frontmatter (${(err as Error).message})`);
    return null;
  }
  const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : '';
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '';
  if (!name || !description) {
    onWarning?.(`Skipping ${path}: missing name or description`);
    return null;
  }
  const id = name;
  const metadata = (frontmatter.metadata && typeof frontmatter.metadata === 'object')
    ? frontmatter.metadata as Record<string, unknown>
    : {};
  const category = typeof metadata.category === 'string' ? metadata.category : '';
  const tags = Array.isArray(metadata.tags) ? metadata.tags.filter((t): t is string => typeof t === 'string') : [];
  const owner = typeof frontmatter.owner === 'string' && frontmatter.owner.trim() ? frontmatter.owner.trim() : undefined;
  const repos = Array.isArray(frontmatter.repos)
    ? frontmatter.repos.filter((r): r is string => typeof r === 'string' && r.trim().length > 0).map((r) => r.trim())
    : [];
  const visibility = parseVisibility(frontmatter.visibility, path, onWarning);
  // Deliberately excludes owner/repos/visibility: this hash only guards the embedding cache
  // (embeddingText() below never reads provenance), so a pure ownership edit shouldn't force a
  // re-embed. Provenance is metadata about the entry, not content the embedder sees.
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ name, description, category, tags }))
    .digest('hex')
    .slice(0, 16);
  return { id, sourcePath: path, name, description, category, tags, owner, repos, visibility, contentHash };
}

const KNOWN_VISIBILITIES: ReadonlySet<SkillVisibility> = new Set(['private', 'listed', 'public']);

/**
 * Parses frontmatter `visibility` defensively. Absence is privacy, never exposure: a missing
 * field, a non-string value, or a string that isn't exactly one of the three known tiers all
 * resolve to `'private'` — the narrowest tier, never a guess at something wider. An unrecognized
 * value warns (when a warning sink is given) so a typo in someone's frontmatter surfaces instead
 * of silently doing nothing, but it still never coerces upward.
 */
function parseVisibility(raw: unknown, path: string, onWarning?: (msg: string) => void): SkillVisibility {
  if (raw === undefined || raw === null) return 'private';
  if (typeof raw !== 'string') {
    // Deliberately doesn't fall through to String(raw): a single-element array
    // like ['public'] would otherwise stringify to "public" and slip past the
    // check below as if it were a real string value.
    onWarning?.(`${path}: visibility must be a string, got ${typeof raw}, defaulting to private`);
    return 'private';
  }
  const normalized = raw.trim().toLowerCase();
  if (KNOWN_VISIBILITIES.has(normalized as SkillVisibility)) return normalized as SkillVisibility;
  onWarning?.(`${path}: unknown visibility "${raw}", defaulting to private`);
  return 'private';
}

const DEFAULT_DB_DIR = join(homedir(), '.port-daddy');
const DEFAULT_DB_FILE = 'skill-index.sqlite';

/**
 * Build (or open) the skill index. Idempotent — calling twice with the
 * same options reuses the persisted database. Tests pass `db` directly to
 * keep everything in-memory.
 *
 * @example
 *   const index = createSkillIndex();
 *   await index.index(loadSkillCatalog(['skills']));
 *   const top = await index.search('detect drift between code and docs', { k: 3 });
 *   // → [{skill: documentarian-skill, similarity: 0.79}, ...]
 */
export function createSkillIndex(options: SkillIndexOptions = {}): SkillIndex {
  const db = options.db ?? openDefaultDb(options.dbDir);
  ensureSchema(db);

  const modelId = options.modelId ?? DEFAULT_SEMANTIC_MODEL_ID;
  const cacheDir = options.cacheDir ?? join(DEFAULT_DB_DIR, 'transformers-cache');
  let embedder = options.embedder ?? null;

  async function ensureEmbedder(): Promise<SkillEmbedder> {
    if (embedder) return embedder;
    embedder = await createDefaultSkillEmbedder(cacheDir, modelId);
    return embedder;
  }

  return {
    db,

    async index(skills) {
      const existing = new Map<string, { contentHash: string }>();
      const rows = db.prepare('SELECT skill_id, content_hash FROM shipwright_skill_vectors').all() as Array<{ skill_id: string; content_hash: string }>;
      for (const row of rows) {
        existing.set(row.skill_id, { contentHash: row.content_hash });
      }

      const seen = new Set(skills.map((s) => s.id));
      const stale = [...existing.keys()].filter((id) => !seen.has(id));
      const toEmbed: SkillEntry[] = [];
      let reused = 0;
      for (const skill of skills) {
        const prior = existing.get(skill.id);
        if (prior && prior.contentHash === skill.contentHash) {
          reused++;
          continue;
        }
        toEmbed.push(skill);
      }

      if (toEmbed.length > 0) {
        const enc = await ensureEmbedder();
        // Positional `?` params (bound with an ordered array below), NOT
        // `@named` object binding. `@named` works under better-sqlite3 but
        // SILENTLY BINDS NULL under bun:sqlite (the compiled daemon — see
        // lib/sqlite-runtime.ts). Keep column order in sync with the .run()
        // array. `excluded.*` in the DO UPDATE clause takes no params.
        const upsert = db.prepare(`
          INSERT INTO shipwright_skill_vectors
            (skill_id, source_path, name, description, category, tags, vector_json, content_hash, model_id, embedded_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(skill_id) DO UPDATE SET
            source_path = excluded.source_path,
            name = excluded.name,
            description = excluded.description,
            category = excluded.category,
            tags = excluded.tags,
            vector_json = excluded.vector_json,
            content_hash = excluded.content_hash,
            model_id = excluded.model_id,
            embedded_at = excluded.embedded_at
        `);
        const BATCH = 16;
        for (let i = 0; i < toEmbed.length; i += BATCH) {
          const slice = toEmbed.slice(i, i + BATCH);
          options.onProgress?.({ phase: 'embed-batch', index: i, total: toEmbed.length });
          const vectors = await enc.embed(slice.map((s) => embeddingText(s)));
          const now = Date.now();
          const tx = db.transaction((batch: SkillEntry[], vecs: number[][]) => {
            for (let j = 0; j < batch.length; j++) {
              // Column order: skill_id, source_path, name, description,
              // category, tags, vector_json, content_hash, model_id, embedded_at.
              upsert.run(
                batch[j].id,
                batch[j].sourcePath,
                batch[j].name,
                batch[j].description,
                batch[j].category,
                JSON.stringify(batch[j].tags),
                JSON.stringify(vecs[j]),
                batch[j].contentHash,
                enc.modelId,
                now,
              );
            }
          });
          tx(slice, vectors);
        }
      }

      let removed = 0;
      if (stale.length > 0) {
        const del = db.prepare('DELETE FROM shipwright_skill_vectors WHERE skill_id = ?');
        const tx = db.transaction((ids: string[]) => {
          for (const id of ids) del.run(id);
        });
        tx(stale);
        removed = stale.length;
      }

      return { embedded: toEmbed.length, reused, removed };
    },

    async search(query, opts = {}) {
      const k = opts.k ?? 5;
      const preferred = new Set(opts.preferred ?? []);
      const boost = opts.preferredBoost ?? 0.05;
      const enc = await ensureEmbedder();
      const [queryVector] = await enc.embed([query]);
      const rows = db.prepare(`
        SELECT skill_id, source_path, name, description, category, tags, vector_json, content_hash
          FROM shipwright_skill_vectors
      `).all() as Array<{
        skill_id: string;
        source_path: string;
        name: string;
        description: string;
        category: string;
        tags: string;
        vector_json: string;
        content_hash: string;
      }>;
      const scored: SkillSearchResult[] = [];
      for (const row of rows) {
        const vec = JSON.parse(row.vector_json) as number[];
        const sim = cosine(queryVector, vec) + (preferred.has(row.skill_id) ? boost : 0);
        scored.push({
          skill: {
            id: row.skill_id,
            sourcePath: row.source_path,
            name: row.name,
            description: row.description,
            category: row.category,
            tags: parseTagsJson(row.tags),
            // The persisted vector cache predates provenance and doesn't carry
            // owner/repos/visibility — reconstructing from a cache row falls
            // back to the same defaults an absent frontmatter would parse to
            // (private, no owner), never a guess at something wider.
            repos: [],
            visibility: 'private',
            contentHash: row.content_hash,
          },
          similarity: sim,
        });
      }
      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, k);
    },

    clear() {
      db.exec('DELETE FROM shipwright_skill_vectors');
    },
  };
}

function embeddingText(skill: SkillEntry): string {
  // Combine the description with category + tags so cosine queries that
  // mention either dimension still surface the right entry. Prepending
  // the name gives a small boost to direct-name queries without becoming
  // a keyword match (the embedder treats it as one more token, not a key).
  const parts = [skill.name, skill.category, skill.tags.join(' '), skill.description].filter(Boolean);
  return parts.join('\n');
}

function parseTagsJson(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function cosine(a: number[], b: number[]): number {
  // MiniLM emits L2-normalized vectors, so cosine === dot product. Same
  // assumption `lib/semantic-resolver.ts cosineSimilarity` makes.
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function openDefaultDb(dbDir?: string): DatabaseInstance {
  const dir = dbDir ?? DEFAULT_DB_DIR;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, DEFAULT_DB_FILE);
  return new Database(file);
}

function ensureSchema(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shipwright_skill_vectors (
      skill_id     TEXT PRIMARY KEY,
      source_path  TEXT NOT NULL,
      name         TEXT NOT NULL,
      description  TEXT NOT NULL,
      category     TEXT NOT NULL DEFAULT '',
      tags         TEXT NOT NULL DEFAULT '[]',
      vector_json  TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      embedded_at  INTEGER NOT NULL
    );
  `);
}

/**
 * Lazy MiniLM loader using the same pattern `lib/semantic-resolver.ts`
 * uses. Kept private to this module so the import of `@huggingface/transformers`
 * only happens for callers that actually run a search; CLI tests with an
 * injected embedder never touch the heavy module.
 */
async function createDefaultSkillEmbedder(cacheDir: string, modelId: string): Promise<SkillEmbedder> {
  mkdirSync(cacheDir, { recursive: true });
  ensureOnnxRuntimeNativeLibFindable();
  const transformers = await import('@huggingface/transformers');
  const { env, pipeline } = transformers as unknown as {
    env: { cacheDir: string; useFSCache: boolean; allowRemoteModels: boolean };
    pipeline: (task: string, model: string) => Promise<(text: string, opts: { pooling: string; normalize: boolean }) => Promise<unknown>>;
  };
  env.cacheDir = cacheDir;
  env.useFSCache = true;
  env.allowRemoteModels = true;
  const featureExtractor = await pipeline('feature-extraction', modelId);
  return {
    modelId,
    async embed(texts) {
      const out: number[][] = [];
      for (const text of texts) {
        const result = await featureExtractor(text, { pooling: 'mean', normalize: true });
        out.push(extractVector(result));
      }
      return out;
    },
  };
}

// Same vector-extraction shape Transformers.js returns; mirrors
// `lib/semantic-resolver.ts extractVector` so we don't drift if upstream
// adds a fourth output shape.
function extractVector(result: unknown): number[] {
  if (Array.isArray(result)) return flatten(result);
  if (result && typeof result === 'object') {
    const r = result as { data?: ArrayLike<number>; tolist?: () => unknown };
    if (typeof r.tolist === 'function') return flatten(r.tolist());
    if (r.data) return Array.from(r.data);
  }
  return [];
}

function flatten(value: unknown): number[] {
  const out: number[] = [];
  const stack: unknown[] = [value];
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === 'number') out.push(next);
    else if (Array.isArray(next)) for (let i = next.length - 1; i >= 0; i--) stack.push(next[i]);
  }
  return out;
}
