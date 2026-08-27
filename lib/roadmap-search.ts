/**
 * Roadmap Search — Semantic Matching Over roadmap_items
 *
 * Answers "which roadmap item(s) is this work about?" from a free-text
 * purpose string — the missing piece `pd begin`'s rent gate needed. Today
 * `--roadmap <slug>` requires the caller to already know the exact slug;
 * this module lets the daemon suggest candidates instead of just rejecting.
 *
 * Architecture (mirrors lib/whois.ts's capability-phonebook cascade — same
 * shared resolver, same BM25-then-cosine shape, deliberately not a new
 * pattern):
 *   - Each item's `summary_md` (+ `description_md` when present) is embedded
 *     via the shared semantic resolver and persisted to a sidecar table,
 *     `roadmap_item_embeddings`, keyed by (harbor, slug) with a content hash
 *     so a re-index is a no-op when the text hasn't changed.
 *   - Query flow: exact-slug short-circuit → BM25 over the summary/description
 *     corpus (top candidates) → cosine rerank over the candidate embeddings.
 *   - No LLM tiebreak here (unlike whois): roadmap suggestions are a cheap,
 *     printed hint at `pd begin` time, not a routing decision with a single
 *     right answer — showing 3-5 ranked candidates is the correct UX, not
 *     collapsing to one.
 *   - A light status boost (not a hard filter) prefers actionable items
 *     (now/backlog) over historical ones (done/parked) at equal similarity,
 *     since "what am I about to work on" should surface live work first.
 *
 * No keyword-list NLP: matching is BM25 + embedding cosine, never a
 * substring/regex classifier over free text (CLAUDE.md discipline, same
 * rule whois.ts documents).
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SemanticResolver } from './semantic-resolver.js';
import type { RoadmapItem, RoadmapStatus } from './roadmap-items.js';

// ─── Constants ────────────────────────────────────────────────────────────

/** Top-K candidates the BM25 stage forwards to cosine rerank. */
const BM25_CANDIDATE_LIMIT = 25;

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
  stage: 'exact-slug' | 'bm25' | 'semantic';
}

export interface RoadmapSearchOptions {
  harbor?: string;
  /** Cap the response. Defaults to 5 — a `pd begin` hint, not a full listing. */
  limit?: number;
}

export interface RoadmapSearch {
  /** Embed one item's text and persist it. Cheap no-op if the text is unchanged. */
  reindexItem(item: Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>): Promise<{ indexed: boolean }>;
  /** Re-embed every row a lister provides — the backfill path for a fresh index. */
  reindexAll(items: readonly Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>[]): Promise<{ indexed: number; skipped: number }>;
  /** Rank roadmap items against free text. Empty query or empty corpus -> []. */
  search(query: string, opts?: RoadmapSearchOptions): Promise<RoadmapSearchHit[]>;
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
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i] as number) * (b[i] as number);
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
  resolver: Pick<SemanticResolver, 'embed' | 'modelId'>;
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface EmbeddingRow {
  harbor: string;
  slug: string;
  summary_md: string;
  status: string;
  embedding: Buffer;
  content_hash: string;
}

export function createRoadmapSearch(db: Database.Database, deps: RoadmapSearchDeps): RoadmapSearch {
  const { resolver, logger } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS roadmap_item_embeddings (
      harbor       TEXT NOT NULL,
      slug         TEXT NOT NULL,
      summary_md   TEXT NOT NULL,
      status       TEXT NOT NULL,
      embedding    BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (harbor, slug)
    );
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO roadmap_item_embeddings
        (harbor, slug, summary_md, status, embedding, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(harbor, slug)
      DO UPDATE SET summary_md = excluded.summary_md,
                    status = excluded.status,
                    embedding = excluded.embedding,
                    content_hash = excluded.content_hash,
                    updated_at = excluded.updated_at
    `),
    getHash: db.prepare(`
      SELECT content_hash FROM roadmap_item_embeddings WHERE harbor = ? AND slug = ?
    `),
    listAll: db.prepare(`
      SELECT harbor, slug, summary_md, status, embedding, content_hash
      FROM roadmap_item_embeddings
    `),
    listByHarbor: db.prepare(`
      SELECT harbor, slug, summary_md, status, embedding, content_hash
      FROM roadmap_item_embeddings
      WHERE harbor = ?
    `),
  };

  async function reindexItem(
    item: Pick<RoadmapItem, 'slug' | 'harbor' | 'summaryMd' | 'descriptionMd' | 'status'>,
  ): Promise<{ indexed: boolean }> {
    if (!item.slug || !item.harbor) return { indexed: false };
    const text = itemText(item).trim();
    if (!text) return { indexed: false };

    const hash = contentHash(text);
    const existing = stmts.getHash.get(item.harbor, item.slug) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return { indexed: false };

    try {
      const vector = await resolver.embed(text);
      if (!vector.length) return { indexed: false };
      stmts.upsert.run(
        item.harbor, item.slug, item.summaryMd ?? '', item.status,
        vectorToBlob(vector), hash, Date.now(),
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

  function loadCorpus(harbor: string | undefined): CorpusEntry[] {
    const rows = (harbor ? stmts.listByHarbor.all(harbor) : stmts.listAll.all()) as EmbeddingRow[];
    return rows.map((row) => ({
      slug: row.slug,
      harbor: row.harbor,
      summaryMd: row.summary_md,
      status: row.status as RoadmapStatus,
      embedding: blobToVector(row.embedding),
      tokens: tokenize(row.summary_md),
    }));
  }

  async function search(query: string, opts: RoadmapSearchOptions = {}): Promise<RoadmapSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50);
    const corpus = loadCorpus(opts.harbor);
    if (corpus.length === 0) return [];

    // Stage 1: exact-slug short-circuit (the caller already knows the slug).
    const slugish = trimmed.toLowerCase().replace(/\s+/g, '-');
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
      }));
    }

    // Stage 2: BM25 over the summary/description corpus.
    const queryTokens = tokenize(trimmed);
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
    const positiveBM25 = scored.filter((s) => s.bm25 > 0).sort((a, b) => b.bm25 - a.bm25).slice(0, BM25_CANDIDATE_LIMIT);
    const candidates = positiveBM25.length > 0 ? positiveBM25 : scored;

    // Stage 3: cosine rerank over the candidate embeddings.
    const queryVector = await resolver.embed(trimmed);
    if (queryVector.length === 0) return [];

    const stage: RoadmapSearchHit['stage'] = positiveBM25.length > 0 ? 'bm25' : 'semantic';
    const hits: RoadmapSearchHit[] = candidates.map(({ entry, bm25 }) => {
      const similarity = dot(queryVector, entry.embedding);
      return {
        slug: entry.slug,
        harbor: entry.harbor,
        summaryMd: entry.summaryMd,
        status: entry.status,
        similarity,
        bm25Score: bm25 > 0 ? bm25 : null,
        score: similarity * statusBoost(entry.status),
        stage,
      };
    });
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  return { reindexItem, reindexAll, search };
}
