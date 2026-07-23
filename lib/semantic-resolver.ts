import type Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { GraphEdges } from './graph-edges.js';
import type { Counters } from './counters.js';
import type { TupleSpace } from './tuples.js';
import type { SemanticAlias } from './semantic-terms.js';
import { createGatedLoader } from './observability/gated-loader.js';
import type { LogGovernor } from './observability/log-governor.js';

/**
 * Default local embedding model used for term-level semantic resolution.
 *
 * This is the community-standard 384-dimensional MiniLM encoder that works
 * well for lightweight phrase similarity and has an excellent size/quality
 * tradeoff for local-first Port Daddy installations.
 */
export const DEFAULT_SEMANTIC_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/**
 * The ONE stable cache dir for the local embedding model, shared by every reader
 * (the resolver, the daemon, the shipwright skill index) and the install-time
 * prefetch (scripts/prefetch-embedding-model.ts). Under `~/.port-daddy/` so it
 * survives reinstalls and is identical whether the caller's cwd is the repo, a
 * worktree, or the launchd daemon's bare dir — prefetch writes here, runtime reads
 * here. Overridable via `PD_TRANSFORMERS_CACHE_DIR`. (ADR-0061.)
 */
export function defaultTransformersCacheDir(): string {
  return (
    process.env.PD_TRANSFORMERS_CACHE_DIR?.trim() ||
    join(homedir(), '.port-daddy', 'transformers-cache')
  );
}
export const DEFAULT_SEMANTIC_AUTO_THRESHOLD = 0.88;
export const DEFAULT_SEMANTIC_REVIEW_THRESHOLD = 0.8;
export const DEFAULT_SEMANTIC_BOUNDARY_MARGIN = 0.02;
export const DEFAULT_SEMANTIC_CANDIDATE_LIMIT = 5;
const SEMANTIC_TUPLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type SemanticReviewAction = 'accept' | 'reject';
export type SemanticResolutionDecision = 'seeded' | 'auto' | 'review' | 'reject' | 'accepted' | 'rejected' | 'error';

/**
 * A single semantic candidate considered during term resolution.
 *
 * Example:
 * ```ts
 * {
 *   term: 'css design-system port-daddy site',
 *   similarity: 0.89
 * }
 * ```
 */
export interface SemanticResolutionCandidate {
  term: string;
  similarity: number;
}

/**
 * Persisted decision record for one semantic alias observation.
 *
 * Example:
 * ```ts
 * {
 *   id: 41,
 *   projectDir: '/Users/erichowens/coding/port-daddy',
 *   harbor: 'port-daddy:fleet',
 *   sourceType: 'fleet_agent_task',
 *   sourceId: 'port-daddy:doc-bot:1710000000000',
 *   rawTerm: 'Writing the CSS for Port Daddy website design system',
 *   canonicalTerm: 'css design-system port-daddy site',
 *   candidateTerm: 'css design-system port-daddy docs',
 *   similarity: 0.81,
 *   decision: 'review',
 *   thresholdAuto: 0.88,
 *   thresholdReview: 0.8,
 *   model: 'Xenova/all-MiniLM-L6-v2',
 *   metadata: { candidates: [...] },
 *   createdAt: 1710000000000
 * }
 * ```
 */
export interface SemanticResolutionEvent {
  id: number;
  projectDir: string | null;
  harbor: string | null;
  sourceType: string;
  sourceId: string;
  rawTerm: string;
  canonicalTerm: string;
  candidateTerm: string | null;
  similarity: number | null;
  decision: SemanticResolutionDecision;
  thresholdAuto: number;
  thresholdReview: number;
  model: string;
  metadata: Record<string, unknown> | null;
  reviewAction: SemanticReviewAction | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: number | null;
  createdAt: number;
}

/**
 * Durable operator override applied to a semantic candidate pair.
 *
 * Example:
 * ```ts
 * {
 *   id: 3,
 *   projectDir: '/Users/erichowens/coding/port-daddy',
 *   canonicalTerm: 'css design-system port-daddy docs',
 *   candidateTerm: 'css design-system port-daddy site',
 *   action: 'accept',
 *   reviewer: 'eric',
 *   note: 'Same workstream, keep them joined',
 *   sourceEventId: 42,
 *   createdAt: 1710000000000,
 *   updatedAt: 1710000005000
 * }
 * ```
 */
export interface SemanticResolutionOverride {
  id: number;
  projectDir: string | null;
  canonicalTerm: string;
  candidateTerm: string;
  action: SemanticReviewAction;
  reviewer: string | null;
  note: string | null;
  sourceEventId: number | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Aggregate health report for the current semantic-resolution policy.
 *
 * The point of this structure is to make the thresholds inspectable instead of
 * folklore. Near-boundary counts are especially important when deciding whether
 * the current "magic number" is too strict or too loose.
 */
export interface SemanticResolutionStats {
  model: string;
  autoThreshold: number;
  reviewThreshold: number;
  boundaryMargin: number;
  totalTerms: number;
  totalEvents: number;
  reviewBacklog: number;
  reviewedCount: number;
  acceptedOverrides: number;
  rejectedOverrides: number;
  nearAutoBoundary: number;
  nearReviewBoundary: number;
  lastResolvedAt: number | null;
  decisions: Record<SemanticResolutionDecision, number>;
}

/**
 * Search result returned when querying the learned semantic term index.
 *
 * Example:
 * ```ts
 * {
 *   term: 'css design-system port-daddy site',
 *   similarity: 0.92,
 *   fingerprint: '9b0f8cc4aef1d2a4',
 *   tokens: ['css', 'design-system', 'port-daddy', 'site']
 * }
 * ```
 */
export interface SemanticSearchResult {
  term: string;
  similarity: number;
  fingerprint: string | null;
  tokens: string[];
}

/**
 * Machine-readable observation submitted by tuple, merge, or memory producers.
 *
 * Example:
 * ```ts
 * {
 *   projectDir: '/Users/erichowens/coding/port-daddy',
 *   harbor: 'port-daddy:fleet',
 *   sourceType: 'merge',
 *   sourceId: 'entry:12',
 *   agentId: 'architect',
 *   aliases: [
 *     {
 *       raw: 'Writing the CSS for Port Daddy website design system',
 *       canonical: 'css design-system port-daddy site',
 *       tokens: ['css', 'design-system', 'port-daddy', 'site'],
 *       fingerprint: '9b0f8cc4aef1d2a4'
 *     }
 *   ]
 * }
 * ```
 */
export interface SemanticObservationInput {
  projectDir?: string | null;
  harbor?: string | null;
  sourceType: string;
  sourceId: string;
  agentId?: string | null;
  aliases: SemanticAlias[];
}

/**
 * Optional collaborators for the semantic resolver.
 *
 * `embedder` exists primarily for tests so we can assert threshold behavior
 * deterministically without downloading a model during CI.
 */
interface SemanticResolverOptions {
  cacheDir?: string;
  modelId?: string;
  autoThreshold?: number;
  reviewThreshold?: number;
  boundaryMargin?: number;
  candidateLimit?: number;
  counters?: Pick<Counters, 'bump'>;
  graphEdges?: Pick<GraphEdges, 'remember'>;
  tuples?: Pick<TupleSpace, 'out'>;
  logger?: {
    error(msg: string, meta?: Record<string, unknown>): void;
    info?(msg: string, meta?: Record<string, unknown>): void;
  };
  /**
   * Governed logger. When provided, embedder-load failures and per-alias resolution errors are
   * deduped/rate-limited instead of logging the full error on every fleet-agent tick — the fix
   * for the `semantic_resolution_failed` 7,182×-in-a-loop write storm. Optional so existing
   * callers/tests are unaffected; without it, logging falls back to `logger.error`.
   */
  governor?: Pick<LogGovernor, 'governed'>;
  embedder?: {
    modelId: string;
    embed(texts: string[]): Promise<number[][]>;
  };
  /**
   * Factory for the lazily-loaded embedder (defaults to the ONNX/transformers loader). Injectable
   * so the gated-loader failure path — the actual `semantic_resolution_failed` runaway — is testable
   * without a real native dependency. Ignored when `embedder` is supplied directly.
   */
  embedderFactory?: () => Promise<{ modelId: string; embed(texts: string[]): Promise<number[][]> }>;
}

interface SemanticTermRow {
  term: string;
  model: string;
  dimensions: number;
  vector_json: string;
  fingerprint: string | null;
  tokens_json: string | null;
  first_project_dir: string | null;
  created_at: number;
  updated_at: number;
}

interface SemanticResolutionRow {
  id: number;
  project_dir: string | null;
  harbor: string | null;
  source_type: string;
  source_id: string;
  raw_term: string;
  canonical_term: string;
  candidate_term: string | null;
  similarity: number | null;
  decision: SemanticResolutionDecision;
  threshold_auto: number;
  threshold_review: number;
  model: string;
  metadata: string | null;
  review_action: SemanticReviewAction | null;
  reviewed_by: string | null;
  review_note: string | null;
  reviewed_at: number | null;
  created_at: number;
}

interface SemanticOverrideRow {
  id: number;
  project_key: string;
  project_dir: string | null;
  canonical_term: string;
  candidate_term: string;
  action: SemanticReviewAction;
  reviewer: string | null;
  note: string | null;
  source_event_id: number | null;
  created_at: number;
  updated_at: number;
}

type EmbeddingPipelineResult = {
  data?: ArrayLike<number>;
  dims?: number[];
  tolist?: () => unknown;
};

/**
 * Public semantic-resolution service contract.
 *
 * All producers should treat this as a background enrichment surface rather
 * than a synchronous correctness dependency. The cheap lexical canonicalizer
 * still runs first; this service adds embedding-based joins, telemetry, and
 * later operator review.
 */
export interface SemanticResolver {
  modelId: string;
  autoThreshold: number;
  reviewThreshold: number;
  boundaryMargin: number;
  candidateLimit: number;
  cacheDir: string;

  /**
   * Queue semantic alias observations for background resolution.
   *
   * Example input:
   * ```ts
   * semanticResolver.observeAliases({
   *   projectDir: '/Users/erichowens/coding/port-daddy',
   *   harbor: 'port-daddy:fleet',
   *   sourceType: 'memory',
   *   sourceId: 'session-css-1:handoff',
   *   agentId: 'designer',
   *   aliases: collectSemanticAliases([
   *     'Writing the CSS for Port Daddy website design system'
   *   ]),
   * });
   * ```
   *
   * Example output:
   * - No direct return value.
   * - Side effects:
   *   - persists `semantic_resolution_events`
   *   - emits `semantic:resolution` tuples
   *   - writes `embedding_match` / `embedding_candidate` graph edges
   */
  observeAliases(input: SemanticObservationInput): void;

  /**
   * Return recent persisted resolution decisions for operator review.
   */
  listResolutions(options?: {
    projectDir?: string;
    decision?: SemanticResolutionDecision;
    query?: string;
    minSimilarity?: number;
    limit?: number;
  }): SemanticResolutionEvent[];

  /**
   * Persist an operator review decision for a candidate pair so future
   * resolutions can honor the reviewed outcome instead of relying only on
   * the raw cosine threshold.
   *
   * Example:
   * ```ts
   * const event = semanticResolver.review(42, {
   *   action: 'accept',
   *   reviewer: 'operator',
   *   note: 'These labels are the same workstream.',
   * });
   * ```
   */
  review(eventId: number, options: {
    action: SemanticReviewAction;
    reviewer?: string | null;
    note?: string | null;
  }): SemanticResolutionEvent;

  /**
   * Embed a single text into its raw normalized vector.
   *
   * Unlike `search`, this does not touch the persisted term inventory — it is
   * a thin pass-through to the underlying embedder so callers (e.g. the whois
   * phonebook) can build their own sidecar embedding stores.
   *
   * Example:
   * ```ts
   * const vector = await semanticResolver.embed('react server components');
   * // vector.length === 384 for all-MiniLM-L6-v2
   * ```
   */
  embed(text: string): Promise<number[]>;

  /**
   * Run semantic nearest-neighbor search over the known term inventory.
   *
   * Example input:
   * ```ts
   * await semanticResolver.search('port daddy css tokens', { limit: 3 });
   * ```
   *
   * Example output:
   * ```ts
   * [
   *   {
   *     term: 'css design-system port-daddy site',
   *     similarity: 0.91,
   *     fingerprint: '9b0f8cc4aef1d2a4',
   *     tokens: ['css', 'design-system', 'port-daddy', 'site']
   *   }
   * ]
   * ```
   */
  search(query: string, options?: { limit?: number }): Promise<SemanticSearchResult[]>;

  /**
   * Summarize current threshold posture and recent decision counts.
   */
  stats(projectDir?: string): SemanticResolutionStats;

  /**
   * Wait for all currently queued observations to finish processing.
   *
   * This exists mainly for tests and explicit drain/shutdown points.
   */
  flush(): Promise<void>;
}

/**
 * Safely parse JSON metadata from SQLite.
 */
function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Safely parse a JSON string array from SQLite.
 */
function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Decode a persisted embedding vector.
 */
function parseVector(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry));
}

/**
 * Convert a SQLite row into the API-facing event shape.
 */
function toResolutionEvent(row: SemanticResolutionRow): SemanticResolutionEvent {
  return {
    id: row.id,
    projectDir: row.project_dir,
    harbor: row.harbor,
    sourceType: row.source_type,
    sourceId: row.source_id,
    rawTerm: row.raw_term,
    canonicalTerm: row.canonical_term,
    candidateTerm: row.candidate_term,
    similarity: row.similarity,
    decision: row.decision,
    thresholdAuto: row.threshold_auto,
    thresholdReview: row.threshold_review,
    model: row.model,
    metadata: parseJsonObject(row.metadata),
    reviewAction: row.review_action ?? null,
    reviewedBy: row.reviewed_by ?? null,
    reviewNote: row.review_note ?? null,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Convert a SQLite override row into the public override shape.
 */
function toResolutionOverride(row: SemanticOverrideRow): SemanticResolutionOverride {
  return {
    id: row.id,
    projectDir: row.project_dir,
    canonicalTerm: row.canonical_term,
    candidateTerm: row.candidate_term,
    action: row.action,
    reviewer: row.reviewer ?? null,
    note: row.note ?? null,
    sourceEventId: row.source_event_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Compute cosine similarity for normalized vectors.
 *
 * The embedder already returns normalized vectors, so cosine similarity reduces
 * to a dot product here. Exported so other reusers of the local embedder (e.g.
 * the LLM semantic response cache, lib/llm-call.ts) share the exact same metric
 * instead of reinventing it.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

/**
 * Bucket a similarity score into coarse operator-facing bands.
 */
function similarityBand(similarity: number | null): string {
  if (similarity === null) return 'none';
  if (similarity >= 0.9) return '0.90+';
  if (similarity >= 0.85) return '0.85-0.89';
  if (similarity >= 0.8) return '0.80-0.84';
  if (similarity >= 0.7) return '0.70-0.79';
  return '<0.70';
}

/**
 * Flatten nested tensor-like output from Transformers.js into a plain vector.
 */
function flattenUnknownArray(input: unknown): number[] {
  if (typeof input === 'number' && Number.isFinite(input)) return [input];
  if (Array.isArray(input)) return input.flatMap(flattenUnknownArray);
  return [];
}

/**
 * Extract a numeric embedding vector from one of the shapes returned by
 * Transformers.js feature-extraction pipelines.
 */
function extractVector(result: EmbeddingPipelineResult | unknown): number[] {
  if (result && typeof result === 'object' && 'data' in result) {
    const data = (result as EmbeddingPipelineResult).data;
    if (data && typeof data.length === 'number') {
      return Array.from(data as ArrayLike<number>).map((value) => Number(value));
    }
  }
  if (result && typeof result === 'object' && 'tolist' in result && typeof result.tolist === 'function') {
    return flattenUnknownArray(result.tolist());
  }
  return flattenUnknownArray(result);
}

/** A minimal local embedder: text → normalized vectors, no DB, no remote service. */
export interface LocalEmbedder {
  modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Public, standalone local embedder — the same `Xenova/all-MiniLM-L6-v2`
 * pipeline the semantic resolver uses, but without needing a DB or the full
 * resolver. Reusers (e.g. the LLM semantic response cache, lib/llm-call.ts) get
 * the operator's existing local embedding model instead of standing up a new
 * embedding service or an external vector DB. Lazy: the model loads on first
 * `embed()`.
 */
export function createLocalEmbedder(
  options: { cacheDir?: string; modelId?: string } = {},
): LocalEmbedder {
  const cacheDir = options.cacheDir ?? join(process.cwd(), '.cache', 'transformers');
  const modelId = options.modelId ?? DEFAULT_SEMANTIC_MODEL_ID;
  let inner: { modelId: string; embed(texts: string[]): Promise<number[][]> } | null = null;
  return {
    modelId,
    async embed(texts: string[]): Promise<number[][]> {
      if (!inner) inner = await createDefaultEmbedder(cacheDir, modelId);
      return inner.embed(texts);
    },
  };
}

/**
 * Lazily load the local embedding pipeline with persistent filesystem cache.
 *
 * The first use may download model artifacts. Subsequent uses on the same
 * machine should hit the cache directory and stay local.
 */
async function createDefaultEmbedder(cacheDir: string, modelId: string): Promise<{ modelId: string; embed(texts: string[]): Promise<number[][]> }> {
  mkdirSync(cacheDir, { recursive: true });
  const { env, pipeline } = await import('@huggingface/transformers');
  env.cacheDir = cacheDir;
  env.useFSCache = true;
  env.allowRemoteModels = true;

  const extractor = await pipeline('feature-extraction', modelId);

  return {
    modelId,
    async embed(texts: string[]): Promise<number[][]> {
      const vectors: number[][] = [];
      for (const text of texts) {
        const result = await extractor(text, { pooling: 'mean', normalize: true });
        vectors.push(extractVector(result));
      }
      return vectors;
    },
  };
}

/**
 * Create the embedding-backed semantic resolver used to reconcile graph and
 * tuple vocabulary across agents.
 *
 * Why this exists:
 * - `collectSemanticAliases()` gives us deterministic lexical canonicalization
 * - embeddings give us soft joins between near-miss aliases
 * - persisted events + counters keep the thresholds observable instead of magic
 *
 * Example:
 * ```ts
 * const semanticResolver = createSemanticResolver(db, {
 *   cacheDir: '/tmp/transformers-cache',
 *   autoThreshold: 0.88,
 *   reviewThreshold: 0.8,
 * });
 * ```
 */
export function createSemanticResolver(db: Database.Database, options: SemanticResolverOptions = {}): SemanticResolver {
  const modelId = options.modelId ?? DEFAULT_SEMANTIC_MODEL_ID;
  const autoThreshold = options.autoThreshold ?? DEFAULT_SEMANTIC_AUTO_THRESHOLD;
  const reviewThreshold = options.reviewThreshold ?? DEFAULT_SEMANTIC_REVIEW_THRESHOLD;
  const boundaryMargin = options.boundaryMargin ?? DEFAULT_SEMANTIC_BOUNDARY_MARGIN;
  const candidateLimit = options.candidateLimit ?? DEFAULT_SEMANTIC_CANDIDATE_LIMIT;
  const cacheDir = options.cacheDir ?? defaultTransformersCacheDir();
  const counters = options.counters;
  const graphEdges = options.graphEdges;
  const tuples = options.tuples;
  const logger = options.logger;

  if (reviewThreshold > autoThreshold) {
    throw new Error(`semantic reviewThreshold (${reviewThreshold}) cannot exceed autoThreshold (${autoThreshold})`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_terms (
      term TEXT NOT NULL,
      model TEXT NOT NULL,
      dimensions INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      fingerprint TEXT,
      tokens_json TEXT,
      first_project_dir TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (term, model)
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_terms_updated ON semantic_terms(updated_at DESC);

    CREATE TABLE IF NOT EXISTS semantic_resolution_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_dir TEXT,
      harbor TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raw_term TEXT NOT NULL,
      canonical_term TEXT NOT NULL,
      candidate_term TEXT,
      similarity REAL,
      decision TEXT NOT NULL,
      threshold_auto REAL NOT NULL,
      threshold_review REAL NOT NULL,
      model TEXT NOT NULL,
      metadata TEXT,
      review_action TEXT,
      reviewed_by TEXT,
      review_note TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_resolution_created ON semantic_resolution_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_semantic_resolution_decision ON semantic_resolution_events(decision, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_semantic_resolution_project ON semantic_resolution_events(project_dir, created_at DESC);

    CREATE TABLE IF NOT EXISTS semantic_resolution_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_key TEXT NOT NULL,
      project_dir TEXT,
      canonical_term TEXT NOT NULL,
      candidate_term TEXT NOT NULL,
      action TEXT NOT NULL,
      reviewer TEXT,
      note TEXT,
      source_event_id INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_override_pair
      ON semantic_resolution_overrides(project_key, canonical_term, candidate_term);
  `);

  for (const sql of [
    'ALTER TABLE semantic_resolution_events ADD COLUMN review_action TEXT',
    'ALTER TABLE semantic_resolution_events ADD COLUMN reviewed_by TEXT',
    'ALTER TABLE semantic_resolution_events ADD COLUMN review_note TEXT',
    'ALTER TABLE semantic_resolution_events ADD COLUMN reviewed_at INTEGER',
  ]) {
    try {
      db.exec(sql);
    } catch {
      // Existing installations already have the reviewed_* columns.
    }
  }

  const stmts = {
    getTerm: db.prepare(`
      SELECT * FROM semantic_terms
      WHERE term = ? AND model = ?
      LIMIT 1
    `),
    upsertTerm: db.prepare(`
      INSERT INTO semantic_terms (
        term, model, dimensions, vector_json, fingerprint, tokens_json, first_project_dir, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(term, model)
      DO UPDATE SET
        dimensions = excluded.dimensions,
        vector_json = excluded.vector_json,
        fingerprint = COALESCE(excluded.fingerprint, semantic_terms.fingerprint),
        tokens_json = COALESCE(excluded.tokens_json, semantic_terms.tokens_json),
        updated_at = excluded.updated_at
    `),
    listTerms: db.prepare(`
      SELECT * FROM semantic_terms
      WHERE model = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `),
    insertEvent: db.prepare(`
      INSERT INTO semantic_resolution_events (
        project_dir, harbor, source_type, source_id, raw_term, canonical_term, candidate_term,
        similarity, decision, threshold_auto, threshold_review, model, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getEvent: db.prepare(`
      SELECT * FROM semantic_resolution_events
      WHERE id = ?
      LIMIT 1
    `),
    updateEventReview: db.prepare(`
      UPDATE semantic_resolution_events
      SET decision = ?, review_action = ?, reviewed_by = ?, review_note = ?, reviewed_at = ?
      WHERE id = ?
    `),
    listEvents: db.prepare(`
      SELECT * FROM semantic_resolution_events
      WHERE (? IS NULL OR project_dir = ?)
        AND (? IS NULL OR decision = ?)
        AND (? IS NULL OR canonical_term LIKE ? OR raw_term LIKE ? OR COALESCE(candidate_term, '') LIKE ?)
        AND (? IS NULL OR similarity >= ?)
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `),
    statsTotals: db.prepare(`
      SELECT
        COUNT(*) AS total_events,
        MAX(created_at) AS last_resolved_at
      FROM semantic_resolution_events
      WHERE (? IS NULL OR project_dir = ?)
    `),
    statsDecisions: db.prepare(`
      SELECT decision, COUNT(*) AS count
      FROM semantic_resolution_events
      WHERE (? IS NULL OR project_dir = ?)
      GROUP BY decision
    `),
    nearThreshold: db.prepare(`
      SELECT COUNT(*) AS count
      FROM semantic_resolution_events
      WHERE (? IS NULL OR project_dir = ?)
        AND similarity IS NOT NULL
        AND ABS(similarity - ?) <= ?
    `),
    countTerms: db.prepare(`
      SELECT COUNT(*) AS count
      FROM semantic_terms
      WHERE model = ?
    `),
    getOverride: db.prepare(`
      SELECT * FROM semantic_resolution_overrides
      WHERE project_key = ? AND canonical_term = ? AND candidate_term = ?
      LIMIT 1
    `),
    upsertOverride: db.prepare(`
      INSERT INTO semantic_resolution_overrides (
        project_key, project_dir, canonical_term, candidate_term, action, reviewer, note,
        source_event_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_key, canonical_term, candidate_term)
      DO UPDATE SET
        action = excluded.action,
        reviewer = excluded.reviewer,
        note = excluded.note,
        source_event_id = excluded.source_event_id,
        updated_at = excluded.updated_at
    `),
  };

  // The embedder is a load-once native dependency (ONNX/transformers). Previously it was memoized
  // as `embedderPromise` and NEVER reset on failure, so a missing dylib became a permanently-rejected
  // promise re-awaited on every fleet-agent tick — 7,182 failures, one error log + DB row each, and
  // a 313 GB write storm. The gated loader wraps creation in a circuit breaker: after a few failures
  // it stops re-attempting the load (no repeated dlopen, no per-tick spam) and periodically re-probes,
  // so a genuinely transient failure still recovers.
  const embedderLoader = createGatedLoader(
    options.embedderFactory ?? (() => createDefaultEmbedder(cacheDir, modelId)),
    { name: `embedder:${modelId}`, failureThreshold: 3, openTimeoutMs: 300_000 },
    options.governor as LogGovernor | undefined,
  );
  const vectorCache = new Map<string, number[]>();
  let queue = Promise.resolve();

  function cacheKey(term: string): string {
    return `${modelId}\x00${term}`;
  }

  function overrideProjectKey(projectDir: string | null | undefined): string {
    return projectDir?.trim() || '__global__';
  }

  function overrideTerms(left: string, right: string): [string, string] {
    return [left, right].sort((a, b) => a.localeCompare(b)) as [string, string];
  }

  function getOverride(projectDir: string | null | undefined, left: string, right: string): SemanticResolutionOverride | null {
    const [canonicalTerm, candidateTerm] = overrideTerms(left, right);
    const row = stmts.getOverride.get(
      overrideProjectKey(projectDir),
      canonicalTerm,
      candidateTerm,
    ) as SemanticOverrideRow | undefined;
    return row ? toResolutionOverride(row) : null;
  }

  /**
   * Resolve the embedder. An injected embedder (tests, custom backends) bypasses the loader.
   * Otherwise the gated loader memoizes success and, on persistent failure, throws CircuitOpenError
   * fast (without re-attempting the native load) so callers skip optional enrichment cheaply.
   */
  async function getEmbedder() {
    if (options.embedder) return options.embedder;
    return embedderLoader.get();
  }

  /**
   * Return an embedding for a canonical term, persisting it when first seen.
   */
  async function ensureTermEmbedding(
    term: string,
    projectDir?: string | null,
    fingerprint?: string | null,
    tokens?: string[],
  ): Promise<number[]> {
    const key = cacheKey(term);
    const cached = vectorCache.get(key);
    if (cached) {
      counters?.bump('semantic.embedding.cache_hit', { model: modelId });
      return cached;
    }

    const existing = stmts.getTerm.get(term, modelId) as SemanticTermRow | undefined;
    if (existing) {
      const vector = parseVector(existing.vector_json);
      vectorCache.set(key, vector);
      counters?.bump('semantic.embedding.cache_hit', { model: modelId });
      return vector;
    }

    counters?.bump('semantic.embedding.cache_miss', { model: modelId });
    const embedder = await getEmbedder();
    const [vector] = await embedder.embed([term]);
    const now = Date.now();
    stmts.upsertTerm.run(
      term,
      modelId,
      vector.length,
      JSON.stringify(vector),
      fingerprint ?? null,
      tokens ? JSON.stringify(tokens) : null,
      projectDir ?? null,
      now,
      now,
    );
    vectorCache.set(key, vector);
    return vector;
  }

  /**
   * Load the currently known term inventory with decoded vectors.
   */
  function listKnownTerms(limit = 5000): Array<SemanticTermRow & { vector: number[]; tokens: string[] }> {
    const rows = stmts.listTerms.all(modelId, Math.min(Math.max(limit, 1), 10000)) as SemanticTermRow[];
    return rows.map((row) => {
      const key = cacheKey(row.term);
      const vector = vectorCache.get(key) ?? parseVector(row.vector_json);
      vectorCache.set(key, vector);
      return {
        ...row,
        vector,
        tokens: parseStringArray(row.tokens_json),
      };
    });
  }

  /**
   * Persist one semantic-resolution decision event.
   */
  function persistResolutionEvent(event: {
    projectDir?: string | null;
    harbor?: string | null;
    sourceType: string;
    sourceId: string;
    rawTerm: string;
    canonicalTerm: string;
    candidateTerm?: string | null;
    similarity?: number | null;
    decision: SemanticResolutionDecision;
    metadata?: Record<string, unknown> | null;
  }): SemanticResolutionEvent {
    const createdAt = Date.now();
    const result = stmts.insertEvent.run(
      event.projectDir ?? null,
      event.harbor ?? null,
      event.sourceType,
      event.sourceId,
      event.rawTerm,
      event.canonicalTerm,
      event.candidateTerm ?? null,
      event.similarity ?? null,
      event.decision,
      autoThreshold,
      reviewThreshold,
      modelId,
      event.metadata ? JSON.stringify(event.metadata) : null,
      createdAt,
    );

    return {
      id: Number(result.lastInsertRowid),
      projectDir: event.projectDir ?? null,
      harbor: event.harbor ?? null,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      rawTerm: event.rawTerm,
      canonicalTerm: event.canonicalTerm,
      candidateTerm: event.candidateTerm ?? null,
      similarity: event.similarity ?? null,
      decision: event.decision,
      thresholdAuto: autoThreshold,
      thresholdReview: reviewThreshold,
      model: modelId,
      metadata: event.metadata ?? null,
      reviewAction: null,
      reviewedBy: null,
      reviewNote: null,
      reviewedAt: null,
      createdAt,
    };
  }

  /**
   * Fan out a completed semantic decision into counters, tuples, and graph edges.
   *
   * This is the core observability hook that keeps threshold tuning visible.
   */
  function recordDecisionSignals(
    event: SemanticResolutionEvent,
    topCandidates: SemanticResolutionCandidate[],
    agentId?: string | null,
  ): void {
    const dims = {
      model: modelId,
      decision: event.decision,
      sourceType: event.sourceType,
      band: similarityBand(event.similarity),
    };
    counters?.bump('semantic.resolution.events', dims);
    counters?.bump(`semantic.resolution.${event.decision}`, { model: modelId, sourceType: event.sourceType });

    if (event.similarity !== null && Math.abs(event.similarity - autoThreshold) <= boundaryMargin) {
      counters?.bump('semantic.resolution.boundary', { model: modelId, boundary: 'auto', sourceType: event.sourceType });
    }
    if (event.similarity !== null && Math.abs(event.similarity - reviewThreshold) <= boundaryMargin) {
      counters?.bump('semantic.resolution.boundary', { model: modelId, boundary: 'review', sourceType: event.sourceType });
    }

    if (tuples) {
      tuples.out([
        'semantic:resolution',
        event.decision,
        event.canonicalTerm,
        event.candidateTerm,
        event.similarity,
        {
          sourceType: event.sourceType,
          sourceId: event.sourceId,
          rawTerm: event.rawTerm,
          thresholds: {
            auto: autoThreshold,
            review: reviewThreshold,
            margin: boundaryMargin,
          },
          model: modelId,
          candidates: topCandidates,
        },
      ], {
        harbor: event.harbor ?? undefined,
        writtenBy: agentId ?? undefined,
        ttlMs: SEMANTIC_TUPLE_TTL_MS,
      });
    }

    if (graphEdges && event.candidateTerm) {
      const edgeType = event.decision === 'auto' || event.decision === 'accepted' ? 'embedding_match' : 'embedding_candidate';
      const scope = `semantic:resolution:${event.sourceType}:${event.sourceId}:${event.canonicalTerm}`;
      graphEdges.remember({
        scope,
        projectDir: event.projectDir,
        sourceType: 'semantic_term',
        sourceId: event.canonicalTerm,
        edgeType,
        targetType: 'semantic_term',
        targetId: event.candidateTerm,
        weight: event.similarity ?? 0,
        metadata: {
          sourceType: event.sourceType,
          sourceId: event.sourceId,
          rawTerm: event.rawTerm,
          decision: event.decision,
          model: modelId,
          thresholdAuto: autoThreshold,
          thresholdReview: reviewThreshold,
          topCandidates,
        },
      });
    }
  }

  /**
   * Resolve a single alias against the known term inventory and classify the
   * result as `seeded`, `auto`, `review`, `reject`, or `error`.
   */
  async function resolveAlias(observation: Omit<SemanticObservationInput, 'aliases'> & { alias: SemanticAlias }): Promise<SemanticResolutionEvent> {
    const { alias } = observation;

    try {
      const vector = await ensureTermEmbedding(
        alias.canonical,
        observation.projectDir,
        alias.fingerprint,
        alias.tokens,
      );
      const candidates = listKnownTerms()
        .filter((row) => row.term !== alias.canonical)
        .map((row) => ({
          term: row.term,
          similarity: cosineSimilarity(vector, row.vector),
        }))
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, candidateLimit);

      const best = candidates[0];
      let decision: SemanticResolutionDecision = 'seeded';
      const override = best ? getOverride(observation.projectDir, alias.canonical, best.term) : null;
      if (best) {
        if (override?.action === 'accept') {
          decision = 'accepted';
        } else if (override?.action === 'reject') {
          decision = 'rejected';
        } else if (best.similarity >= autoThreshold) {
          decision = 'auto';
        } else if (best.similarity >= reviewThreshold) {
          decision = 'review';
        } else {
          decision = 'reject';
        }
      }

      const event = persistResolutionEvent({
        projectDir: observation.projectDir,
        harbor: observation.harbor,
        sourceType: observation.sourceType,
        sourceId: observation.sourceId,
        rawTerm: alias.raw,
        canonicalTerm: alias.canonical,
        candidateTerm: best?.term ?? null,
        similarity: best?.similarity ?? null,
        decision,
        metadata: {
          fingerprint: alias.fingerprint,
          tokens: alias.tokens,
          candidates,
          override: override ? {
            id: override.id,
            action: override.action,
            reviewer: override.reviewer,
            updatedAt: override.updatedAt,
          } : undefined,
        },
      });
      recordDecisionSignals(event, candidates, observation.agentId);
      return event;
    } catch (error) {
      // Governed: keyed on the STABLE event name (never the term/sourceId) so a broken embedder
      // collapses 7,182 identical failures into a few lines + a suppression rollup per window.
      if (options.governor) {
        options.governor.governed({
          key: 'semantic_resolution_failed',
          level: 'error',
          message: 'semantic_resolution_failed',
          meta: {
            error: (error as Error).message,
            term: alias.canonical,
            sourceType: observation.sourceType,
            sourceId: observation.sourceId,
          },
        });
      } else {
        logger?.error('semantic_resolution_failed', {
          error: (error as Error).message,
          term: alias.canonical,
          sourceType: observation.sourceType,
          sourceId: observation.sourceId,
        });
      }

      const event = persistResolutionEvent({
        projectDir: observation.projectDir,
        harbor: observation.harbor,
        sourceType: observation.sourceType,
        sourceId: observation.sourceId,
        rawTerm: alias.raw,
        canonicalTerm: alias.canonical,
        decision: 'error',
        metadata: {
          fingerprint: alias.fingerprint,
          tokens: alias.tokens,
          error: (error as Error).message,
        },
      });
      recordDecisionSignals(event, [], observation.agentId);
      return event;
    }
  }

  /**
   * Queue a batch of semantic aliases for serialized background processing.
   */
  function observeAliases(input: SemanticObservationInput): void {
    if (input.aliases.length === 0) return;
    queue = queue
      .then(async () => {
        for (const alias of input.aliases) {
          await resolveAlias({
            ...input,
            alias,
          });
        }
      })
      .catch((error) => {
        logger?.error('semantic_resolution_queue_failed', { error: (error as Error).message });
      });
  }

  /**
   * Embed a single text into its raw normalized vector via the underlying
   * embedder, bypassing the persisted term inventory. Used by sidecar stores
   * such as the whois phonebook.
   */
  async function embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const embedder = await getEmbedder();
    const [vector] = await embedder.embed([trimmed]);
    return vector ?? [];
  }

  /**
   * Run semantic nearest-neighbor search across all known canonical terms.
   */
  async function search(query: string, options: { limit?: number } = {}): Promise<SemanticSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const embedder = await getEmbedder();
    const [vector] = await embedder.embed([trimmed]);
    return listKnownTerms()
      .map((row) => ({
        term: row.term,
        similarity: cosineSimilarity(vector, row.vector),
        fingerprint: row.fingerprint,
        tokens: row.tokens,
      }))
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, Math.min(Math.max(options.limit ?? candidateLimit, 1), 50));
  }

  /**
   * Return persisted resolution events for review tooling and operator UIs.
   */
  function listResolutions(options: {
    projectDir?: string;
    decision?: SemanticResolutionDecision;
    query?: string;
    minSimilarity?: number;
    limit?: number;
  } = {}): SemanticResolutionEvent[] {
    const like = options.query?.trim() ? `%${options.query.trim()}%` : null;
    const rows = stmts.listEvents.all(
      options.projectDir ?? null,
      options.projectDir ?? null,
      options.decision ?? null,
      options.decision ?? null,
      like,
      like,
      like,
      like,
      options.minSimilarity ?? null,
      options.minSimilarity ?? null,
      Math.min(Math.max(options.limit ?? 100, 1), 500),
    ) as SemanticResolutionRow[];
    return rows.map(toResolutionEvent);
  }

  function review(eventId: number, options: {
    action: SemanticReviewAction;
    reviewer?: string | null;
    note?: string | null;
  }): SemanticResolutionEvent {
    if (options.action !== 'accept' && options.action !== 'reject') {
      throw new Error(`Invalid semantic review action: ${options.action}`);
    }

    const row = stmts.getEvent.get(eventId) as SemanticResolutionRow | undefined;
    if (!row) {
      throw new Error(`Semantic resolution event not found: ${eventId}`);
    }

    const event = toResolutionEvent(row);
    if (!event.candidateTerm) {
      throw new Error(`Semantic resolution event ${eventId} has no candidate term to review`);
    }

    const now = Date.now();
    const [canonicalTerm, candidateTerm] = overrideTerms(event.canonicalTerm, event.candidateTerm);
    stmts.upsertOverride.run(
      overrideProjectKey(event.projectDir),
      event.projectDir,
      canonicalTerm,
      candidateTerm,
      options.action,
      options.reviewer ?? null,
      options.note ?? null,
      event.id,
      now,
      now,
    );

    const reviewedDecision: SemanticResolutionDecision = options.action === 'accept' ? 'accepted' : 'rejected';
    stmts.updateEventReview.run(
      reviewedDecision,
      options.action,
      options.reviewer ?? null,
      options.note ?? null,
      now,
      event.id,
    );

    counters?.bump('semantic.resolution.reviewed', {
      model: modelId,
      action: options.action,
      sourceType: event.sourceType,
    });
    counters?.bump(`semantic.resolution.${reviewedDecision}`, {
      model: modelId,
      sourceType: event.sourceType,
    });

    tuples?.out([
      'semantic:review',
      options.action,
      event.canonicalTerm,
      event.candidateTerm,
      {
        eventId: event.id,
        reviewer: options.reviewer ?? null,
        note: options.note ?? null,
      },
    ], {
      harbor: event.harbor ?? undefined,
      writtenBy: options.reviewer ?? undefined,
      ttlMs: SEMANTIC_TUPLE_TTL_MS,
    });

    const reviewedRow = stmts.getEvent.get(event.id) as SemanticResolutionRow | undefined;
    return toResolutionEvent(reviewedRow ?? row);
  }

  /**
   * Summarize threshold health for the full resolver or one project slice.
   */
  function stats(projectDir?: string): SemanticResolutionStats {
    const totals = stmts.statsTotals.get(projectDir ?? null, projectDir ?? null) as {
      total_events: number;
      last_resolved_at: number | null;
    };
    const decisionRows = stmts.statsDecisions.all(projectDir ?? null, projectDir ?? null) as Array<{
      decision: SemanticResolutionDecision;
      count: number;
    }>;
    const decisions: Record<SemanticResolutionDecision, number> = {
      seeded: 0,
      auto: 0,
      review: 0,
      reject: 0,
      accepted: 0,
      rejected: 0,
      error: 0,
    };
    for (const row of decisionRows) {
      decisions[row.decision] = row.count;
    }
    const nearAutoBoundary = (stmts.nearThreshold.get(projectDir ?? null, projectDir ?? null, autoThreshold, boundaryMargin) as { count: number }).count;
    const nearReviewBoundary = (stmts.nearThreshold.get(projectDir ?? null, projectDir ?? null, reviewThreshold, boundaryMargin) as { count: number }).count;
    const totalTerms = (stmts.countTerms.get(modelId) as { count: number }).count;

    return {
      model: modelId,
      autoThreshold,
      reviewThreshold,
      boundaryMargin,
      totalTerms,
      totalEvents: totals.total_events,
      reviewBacklog: decisions.review,
      reviewedCount: decisions.accepted + decisions.rejected,
      acceptedOverrides: decisions.accepted,
      rejectedOverrides: decisions.rejected,
      nearAutoBoundary,
      nearReviewBoundary,
      lastResolvedAt: totals.last_resolved_at,
      decisions,
    };
  }

  /**
   * Drain the serialized resolution queue.
   */
  function flush(): Promise<void> {
    return queue.then(() => undefined);
  }

  return {
    modelId,
    autoThreshold,
    reviewThreshold,
    boundaryMargin,
    candidateLimit,
    cacheDir,
    observeAliases,
    listResolutions,
    review,
    embed,
    search,
    stats,
    flush,
  };
}
