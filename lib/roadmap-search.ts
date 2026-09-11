/**
 * Roadmap Search — Semantic Matching Over roadmap_items
 *
 * Answers "which roadmap item(s) is this work about?" from a free-text
 * purpose string — the missing piece `pd begin`'s rent gate needed. Today
 * `--roadmap <slug>` requires the caller to already know the exact slug;
 * this module lets the daemon suggest candidates instead of just rejecting.
 *
 * Architecture:
 *   - Each item's `summary_md` (+ `description_md` when present) is embedded
 *     via the shared semantic resolver and persisted to a sidecar table,
 *     `roadmap_item_embeddings`, keyed by (harbor, slug) with a content hash
 *     so a re-index is a no-op when the text hasn't changed.
 *   - Query flow: explicit harbor + privacy admission → exact-slug short-circuit
 *     → independent BM25 and dense rankings → reciprocal-rank fusion at k=60.
 *   - No LLM tiebreak here (unlike whois): roadmap suggestions are a cheap,
 *     printed hint at `pd begin` time, not a routing decision with a single
 *     right answer — showing 3-5 ranked candidates is the correct UX, not
 *     collapsing to one.
 *   - A light status boost (not a hard filter) prefers actionable items
 *     (now/backlog) over historical ones (done/parked) at equal similarity,
 *     since "what am I about to work on" should surface live work first.
 *
 * No keyword-list NLP: matching is BM25 + policy-selected dense retrieval, never a
 * substring/regex classifier over free text (CLAUDE.md discipline, same
 * rule whois.ts documents).
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SemanticResolver } from './semantic-resolver.js';
import type { RoadmapItem, RoadmapStatus } from './roadmap-items.js';
import type { GitleaksRunner } from './handoff-capsule.js';
import { admitRetrievalDerivative, admitRetrievalQuery } from './retrieval-admission.js';

// ─── Constants ────────────────────────────────────────────────────────────

const RRF_K = 60;
export const ROADMAP_SEARCH_CORPUS_ID = 'pd.roadmap.items';

/** Status boost applied before ranking — actionable work surfaces first. */
const STATUS_BOOST: Record<RoadmapStatus, number> = {
  now: 1.15,
  backlog: 1.05,
  merge: 1.0,
  parked: 0.9,
  done: 0.8,
};

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RoadmapSearchHit {
  slug: string;
  harbor: string;
  summaryMd: string;
  status: RoadmapStatus;
  /** Composite score (similarity * status boost); higher is better. */
  score: number;
  /** Raw cosine similarity, or 1.0 for an exact-slug match. */
  similarity: number;
  bm25Score: number | null;
  stage: 'exact-slug' | 'hybrid' | 'bm25' | 'semantic';
  lexicalRank: number | null;
  denseRank: number | null;
}

export interface RoadmapSearchOptions {
  harbor: string;
  /** Cap the response. Defaults to 5 — a `pd begin` hint, not a full listing. */
  limit?: number;
}

export interface RoadmapSearch {
  /** Embed one item's text and persist it. Cheap no-op if the text is unchanged. */
  reindexItem(item: Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>): Promise<{ indexed: boolean }>;
  /** Re-embed every row a lister provides — the backfill path for a fresh index. */
  reindexAll(items: readonly Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>[]): Promise<{ indexed: number; skipped: number }>;
  /** Rank roadmap items against free text. Empty query or empty corpus -> []. */
  search(query: string, opts: RoadmapSearchOptions): Promise<RoadmapSearchHit[]>;
}

// ─── Text helpers (identical tokenizer/BM25 shape to lib/whois.ts) ─────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);
}

function itemText(item: Pick<RoadmapItem, 'summaryMd' | 'descriptionMd'>): string {
  const summary = item.summaryMd ?? '';
  const description = item.descriptionMd ?? '';
  return description ? `${summary}\n${description}` : summary;
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

interface CorpusEntry {
  slug: string;
  harbor: string;
  summaryMd: string;
  status: RoadmapStatus;
  embedding: Float32Array;
  tokens: string[];
}

function bm25Score(
  queryTokens: string[],
  doc: CorpusEntry,
  corpus: { totalDocs: number; avgDocLen: number; docFreq: Map<string, number> },
): number {
  const k1 = 1.2;
  const b = 0.75;
  const docLen = doc.tokens.length;
  if (docLen === 0) return 0;

  let score = 0;
  for (const term of queryTokens) {
    const df = corpus.docFreq.get(term) ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + (corpus.totalDocs - df + 0.5) / (df + 0.5));
    let tf = 0;
    for (const token of doc.tokens) if (token === term) tf++;
    if (tf === 0) continue;
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLen / corpus.avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error(`roadmap embedding dimension mismatch: query=${a.length}, stored=${b.length}`);
  }
  const n = a.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const left = Number(a[i]);
    const right = Number(b[i]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('roadmap embedding contains non-finite values');
    sum += left * right;
  }
  return sum;
}

function vectorToBlob(vector: readonly number[]): Buffer {
  const f32 = new Float32Array(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToVector(blob: Buffer): Float32Array {
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

function statusBoost(status: RoadmapStatus): number {
  return STATUS_BOOST[status] ?? 1.0;
}

// ─── Module factory ──────────────────────────────────────────────────────────

export interface RoadmapSearchDeps {
  resolver: Pick<SemanticResolver, 'embed' | 'modelId' | 'spaceId' | 'corpusPolicy'>;
  gitleaksRunner?: GitleaksRunner;
  now?: () => Date;
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface EmbeddingRow {
  harbor: string;
  slug: string;
  summary_md: string;
  derivative_text: string;
  status: string;
  embedding: Buffer;
  content_hash: string;
  admission_receipt: string;
  corpus_id: string;
  policy_digest: string;
  space_id: string;
  model_id: string;
}

export function createRoadmapSearch(db: Database.Database, deps: RoadmapSearchDeps): RoadmapSearch {
  const { resolver, logger } = deps;
  if (resolver.corpusPolicy.corpusId !== ROADMAP_SEARCH_CORPUS_ID) {
    throw new Error(
      `roadmap search requires corpus ${ROADMAP_SEARCH_CORPUS_ID}, received ${resolver.corpusPolicy.corpusId}`,
    );
  }

  const existingTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'roadmap_item_embeddings'",
  ).get() as { name: string } | undefined;
  if (existingTable) {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(roadmap_item_embeddings)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    const required = ['corpus_id', 'policy_digest', 'space_id', 'model_id', 'admission_receipt', 'derivative_text'];
    if (required.some((column) => !columns.has(column))) {
      db.exec('DROP TABLE roadmap_item_embeddings');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_item_embeddings (
      harbor       TEXT NOT NULL,
      slug         TEXT NOT NULL,
      summary_md   TEXT NOT NULL,
      derivative_text TEXT NOT NULL,
      status       TEXT NOT NULL,
      embedding    BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      admission_receipt TEXT NOT NULL,
      corpus_id    TEXT NOT NULL,
      policy_digest TEXT NOT NULL,
      space_id     TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (harbor, slug, policy_digest, space_id)
    );
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO roadmap_item_embeddings
        (harbor, slug, summary_md, derivative_text, status, embedding, content_hash, admission_receipt,
         corpus_id, policy_digest, space_id, model_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(harbor, slug, policy_digest, space_id)
      DO UPDATE SET summary_md = excluded.summary_md,
                    derivative_text = excluded.derivative_text,
                    status = excluded.status,
                    embedding = excluded.embedding,
                    content_hash = excluded.content_hash,
                    admission_receipt = excluded.admission_receipt,
                    model_id = excluded.model_id,
                    updated_at = excluded.updated_at
    `),
    getHash: db.prepare(`
      SELECT content_hash FROM roadmap_item_embeddings
      WHERE harbor = ? AND slug = ? AND corpus_id = ? AND policy_digest = ? AND space_id = ? AND model_id = ?
    `),
    listByHarbor: db.prepare(`
      SELECT harbor, slug, summary_md, derivative_text, status, embedding, content_hash, admission_receipt,
             corpus_id, policy_digest, space_id, model_id
      FROM roadmap_item_embeddings
      WHERE harbor = ? AND corpus_id = ? AND policy_digest = ? AND space_id = ? AND model_id = ?
    `),
  };

  async function reindexItem(
    item: Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>,
  ): Promise<{ indexed: boolean }> {
    if (!item.slug || !item.harbor) return { indexed: false };
    const sourceText = itemText(item).trim();
    if (!sourceText) return { indexed: false };

    const admitted = admitRetrievalDerivative({
      sourceId: `roadmap:${item.harbor}:${item.slug}`,
      sourceContent: sourceText,
      text: sourceText,
      harborId: item.harbor,
      repoRef: item.harbor,
      policy: resolver.corpusPolicy,
    }, { gitleaksRunner: deps.gitleaksRunner, now: deps.now });
    const admittedSummary = item.summaryMd
      ? admitRetrievalDerivative({
          sourceId: `roadmap:${item.harbor}:${item.slug}:summary`,
          sourceContent: item.summaryMd,
          text: item.summaryMd,
          harborId: item.harbor,
          repoRef: item.harbor,
          policy: resolver.corpusPolicy,
        }, { gitleaksRunner: deps.gitleaksRunner, now: deps.now }).text
      : '';
    const text = admitted.text;

    const hash = contentHash(text);
    const existing = stmts.getHash.get(
      item.harbor,
      item.slug,
      resolver.corpusPolicy.corpusId,
      resolver.corpusPolicy.policyDigest,
      resolver.spaceId,
      resolver.modelId,
    ) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return { indexed: false };

    try {
      const vector = await resolver.embed(text);
      if (!vector.length) return { indexed: false };
      stmts.upsert.run(
        item.harbor, item.slug,
        admittedSummary,
        admitted.text, item.status,
        vectorToBlob(vector), hash, JSON.stringify(admitted.receipt),
        resolver.corpusPolicy.corpusId, resolver.corpusPolicy.policyDigest,
        resolver.spaceId, resolver.modelId, Date.now(),
      );
      return { indexed: true };
    } catch (err) {
      logger?.error?.('roadmap_search_reindex_failed', {
        harbor: item.harbor, slug: item.slug, error: (err as Error).message,
      });
      return { indexed: false };
    }
  }

  async function reindexAll(
    items: readonly Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>[],
  ): Promise<{ indexed: number; skipped: number }> {
    let indexed = 0;
    let skipped = 0;
    for (const item of items) {
      const result = await reindexItem(item);
      if (result.indexed) indexed++;
      else skipped++;
    }
    return { indexed, skipped };
  }

  function loadCorpus(harbor: string): CorpusEntry[] {
    const rows = stmts.listByHarbor.all(
      harbor,
      resolver.corpusPolicy.corpusId,
      resolver.corpusPolicy.policyDigest,
      resolver.spaceId,
      resolver.modelId,
    ) as EmbeddingRow[];
    return rows.map((row) => ({
      slug: row.slug,
      harbor: row.harbor,
      summaryMd: row.summary_md,
      status: row.status as RoadmapStatus,
      embedding: blobToVector(row.embedding),
      tokens: tokenize(row.derivative_text),
    }));
  }

  async function search(query: string, opts: RoadmapSearchOptions): Promise<RoadmapSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const harbor = opts?.harbor?.trim();
    if (!harbor) throw new Error('roadmap search requires an explicit harbor scope');
    const admittedQuery = admitRetrievalQuery({
      queryId: `roadmap-query:${contentHash(trimmed)}`,
      queryText: trimmed,
      harborId: harbor,
      repoRef: harbor,
      policy: resolver.corpusPolicy,
    }, { gitleaksRunner: deps.gitleaksRunner, now: deps.now });

    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
    const corpus = loadCorpus(harbor);
    if (corpus.length === 0) return [];

    // Stage 1: exact-slug short-circuit (the caller already knows the slug).
    const slugish = admittedQuery.text.toLowerCase().replace(/\s+/g, '-');
    const exact = corpus.filter((entry) => entry.slug.toLowerCase() === slugish);
    if (exact.length > 0) {
      return exact.slice(0, limit).map((entry) => ({
        slug: entry.slug,
        harbor: entry.harbor,
        summaryMd: entry.summaryMd,
        status: entry.status,
        similarity: 1.0,
        bm25Score: null,
        score: 1.0 * statusBoost(entry.status),
        stage: 'exact-slug' as const,
        lexicalRank: null,
        denseRank: null,
      }));
    }

    // BM25 and dense similarity rank the same admitted, scope-filtered corpus
    // independently. RRF combines rank positions; raw score scales never mix.
    const queryTokens = tokenize(admittedQuery.text);
    const docFreq = new Map<string, number>();
    let totalLen = 0;
    for (const entry of corpus) {
      totalLen += entry.tokens.length;
      const seen = new Set<string>();
      for (const token of entry.tokens) {
        if (seen.has(token)) continue;
        seen.add(token);
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }
    const corpusStats = { totalDocs: corpus.length, avgDocLen: totalLen / Math.max(1, corpus.length), docFreq };

    const scored = corpus.map((entry) => ({
      entry,
      bm25: queryTokens.length > 0 ? bm25Score(queryTokens, entry, corpusStats) : 0,
    }));
    const lexical = scored.filter((candidate) => candidate.bm25 > 0)
      .sort((left, right) => right.bm25 - left.bm25 || left.entry.slug.localeCompare(right.entry.slug));
    const queryVector = await resolver.embed(admittedQuery.text);
    if (queryVector.length === 0) return [];
    const dense = corpus.map((entry) => ({ entry, similarity: dot(queryVector, entry.embedding) }))
      .sort((left, right) => right.similarity - left.similarity || left.entry.slug.localeCompare(right.entry.slug));
    const lexicalRanks = new Map(lexical.map((candidate, index) => [candidate.entry.slug, index + 1]));
    const denseRanks = new Map(dense.map((candidate, index) => [candidate.entry.slug, index + 1]));
    const lexicalScores = new Map(scored.map((candidate) => [candidate.entry.slug, candidate.bm25]));
    const similarities = new Map(dense.map((candidate) => [candidate.entry.slug, candidate.similarity]));
    const fused = new Map<string, number>();
    for (const [slug, rank] of lexicalRanks) fused.set(slug, 1 / (RRF_K + rank));
    for (const [slug, rank] of denseRanks) fused.set(slug, (fused.get(slug) ?? 0) + 1 / (RRF_K + rank));
    const bySlug = new Map(corpus.map((entry) => [entry.slug, entry]));

    const hits: RoadmapSearchHit[] = [...fused.entries()].map(([slug, fusionScore]) => {
      const entry = bySlug.get(slug) as CorpusEntry;
      const lexicalRank = lexicalRanks.get(slug) ?? null;
      const denseRank = denseRanks.get(slug) ?? null;
      const similarity = similarities.get(slug) ?? 0;
      return {
        slug: entry.slug,
        harbor: entry.harbor,
        summaryMd: entry.summaryMd,
        status: entry.status,
        similarity,
        bm25Score: (lexicalScores.get(slug) ?? 0) > 0 ? lexicalScores.get(slug) as number : null,
        score: fusionScore * statusBoost(entry.status),
        stage: lexicalRank !== null && denseRank !== null ? 'hybrid' : lexicalRank !== null ? 'bm25' : 'semantic',
        lexicalRank,
        denseRank,
      };
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  return { reindexItem, reindexAll, search };
}
