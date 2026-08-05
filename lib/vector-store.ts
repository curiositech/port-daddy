/**
 * Shared vector store — one embedding table for every corpus.
 *
 * **Why this exists.** Port Daddy already embeds things in at least four
 * places: `galaxy_embeddings` (session transcripts, behind the Sextant pane),
 * `durable_agent_profile_embeddings` (roster expertise lookup), the semantic
 * response cache in `lib/llm-call.ts`, and roadmap candidates in
 * `lib/idea-intake.ts`. Each one grew its own table, its own cache discipline,
 * and its own copy of `vectorToBlob` / `blobToVector` / `dot`. That is fine
 * once and a liability by the fourth time: a note embedded for one feature
 * cannot be compared against a roadmap item embedded for another, so the fleet
 * holds a pile of vectors that can never be dot-producted with each other —
 * which is the only thing vectors are for.
 *
 * This module is the shared substrate those callers should converge on. One
 * table, one blob encoding, one cosine implementation, one warm path. New
 * corpora — notes, roadmap items, docs, skills, telos, function docstrings —
 * register a `kind` and get comparability with everything else for free.
 *
 * **Content-addressed, model-versioned.** A row is keyed by `(kind, itemId,
 * modelId)` and carries the SHA-1 of the text it was computed from. Re-embedding
 * is skipped when the hash is unchanged, which is what makes a warm cache warm:
 * the steady state costs one hash per item and zero model invocations. Changing
 * the model changes `modelId` and the old rows simply stop being read, so a
 * model upgrade needs no migration and can be rolled back.
 *
 * **Normalized vectors, so cosine IS dot product.** The MiniLM pipeline returns
 * L2-normalized output, but this normalizes defensively on write — a single
 * un-normalized vector would otherwise silently skew every comparison it takes
 * part in, and the symptom (slightly wrong rankings) is nearly impossible to
 * spot after the fact.
 *
 * **Degradation is explicit, never silent.** Every search reports whether the
 * semantic tier actually ran. Callers are expected to fuse with a lexical tier
 * and label the result degraded when it did not — the pattern established by
 * `lib/durable-agent-roster.ts`. A vector store that quietly returns nothing
 * when the model fails to load is indistinguishable from one that found no
 * matches, and that is exactly the confusion this codebase keeps refusing to
 * ship.
 */

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

/** Text→vector, the shape both `createLocalEmbedder` and the resolver satisfy. */
export interface EmbedderLike {
  readonly modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** One item to embed. `text` is what gets vectorized; `id` is how it is addressed. */
export interface VectorItem {
  readonly id: string;
  readonly text: string;
}

/** A search hit, scored by cosine similarity in [-1, 1]. */
export interface VectorHit {
  readonly id: string;
  readonly score: number;
}

export interface VectorSearchResult {
  readonly hits: readonly VectorHit[];
  /**
   * False when the semantic tier could not run at all (model missing, embed
   * threw, nothing indexed). Callers MUST surface this rather than presenting
   * a lexical-only ranking as if it were semantic.
   */
  readonly semanticAvailable: boolean;
  /** Operator-facing reason when `semanticAvailable` is false. */
  readonly reason?: string;
}

export interface WarmResult {
  /** Items whose text was unchanged — the whole point of the cache. */
  readonly reused: number;
  /** Items actually sent to the model this call. */
  readonly embedded: number;
  readonly semanticAvailable: boolean;
  readonly reason?: string;
}

export interface VectorStoreOptions {
  readonly db: Database.Database;
  readonly embedder: EmbedderLike;
  /** Items per `embed()` call. Batching is the difference between one model
   *  invocation and five hundred. */
  readonly batchSize?: number;
  readonly now?: () => number;
}

/** Default embed batch. Large enough to amortize, small enough to bound memory. */
export const DEFAULT_BATCH_SIZE = 32;

// ─── blob + math (the single copy) ───────────────────────────────────────────

export function vectorToBlob(vector: ArrayLike<number>): Buffer {
  return Buffer.from(new Float32Array(Array.from(vector)).buffer);
}

export function blobToVector(blob: Buffer, dims: number): Float32Array {
  // Copy rather than view: better-sqlite3 may reuse the underlying buffer for
  // the next row, and a view would then mutate under a cached vector.
  const out = new Float32Array(dims);
  for (let i = 0; i < dims; i += 1) out[i] = blob.readFloatLE(i * 4);
  return out;
}

/** Dot product. On L2-normalized vectors this IS cosine similarity. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

/**
 * L2-normalize, defensively.
 *
 * A zero vector is returned unchanged rather than producing NaNs: an empty or
 * degenerate document should score 0 against everything, not poison every
 * comparison it participates in.
 */
export function normalize(vector: readonly number[]): number[] {
  let sumSq = 0;
  for (const v of vector) sumSq += v * v;
  if (sumSq === 0) return [...vector];
  const inv = 1 / Math.sqrt(sumSq);
  return vector.map((v) => v * inv);
}

export function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

// ─── store ───────────────────────────────────────────────────────────────────

interface VectorRow {
  item_id: string;
  content_hash: string;
  dims: number;
  vector: Buffer;
}

export function createVectorStore(options: VectorStoreOptions) {
  const { db, embedder } = options;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const now = options.now ?? Date.now;

  db.prepare(`
    CREATE TABLE IF NOT EXISTS pd_vectors (
      kind         TEXT    NOT NULL,
      item_id      TEXT    NOT NULL,
      model_id     TEXT    NOT NULL,
      content_hash TEXT    NOT NULL,
      dims         INTEGER NOT NULL,
      vector       BLOB    NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (kind, item_id, model_id)
    )
  `).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_pd_vectors_kind ON pd_vectors(kind, model_id)`).run();

  const selectHashes = db.prepare(
    `SELECT item_id, content_hash FROM pd_vectors WHERE kind = ? AND model_id = ?`,
  );
  const selectAll = db.prepare(
    `SELECT item_id, content_hash, dims, vector FROM pd_vectors WHERE kind = ? AND model_id = ?`,
  );
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO pd_vectors (kind, item_id, model_id, content_hash, dims, vector, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteMissing = db.prepare(`DELETE FROM pd_vectors WHERE kind = ? AND model_id = ? AND item_id = ?`);

  /**
   * Hot cache: kind → (itemId → vector).
   *
   * The disk round trip is not the expensive part (the model is), but a search
   * over a few hundred candidates does a few hundred blob decodes, and doing
   * that on every keystroke-adjacent call is exactly the kind of cost that
   * turns a "snappy" pane into a laggy one. Invalidated per-kind on write.
   */
  const hot = new Map<string, Map<string, Float32Array>>();

  const stats = { embedCalls: 0, embedded: 0, reused: 0, cacheHits: 0, cacheMisses: 0 };

  function loadKind(kind: string): Map<string, Float32Array> {
    const cached = hot.get(kind);
    if (cached) {
      stats.cacheHits += 1;
      return cached;
    }
    stats.cacheMisses += 1;
    const map = new Map<string, Float32Array>();
    for (const row of selectAll.all(kind, embedder.modelId) as VectorRow[]) {
      map.set(row.item_id, blobToVector(row.vector, row.dims));
    }
    hot.set(kind, map);
    return map;
  }

  /**
   * Embed whatever has changed, reuse whatever has not.
   *
   * `prune` removes rows for items no longer present in `items` — without it a
   * long-lived kind (open roadmap items, say) accumulates vectors for things
   * that were deleted months ago and keeps offering them as matches. Off by
   * default because a caller passing a *page* of items rather than the whole
   * corpus would otherwise delete everything it did not mention.
   */
  async function warm(
    kind: string,
    items: readonly VectorItem[],
    opts: { prune?: boolean } = {},
  ): Promise<WarmResult> {
    const known = new Map<string, string>();
    for (const row of selectHashes.all(kind, embedder.modelId) as { item_id: string; content_hash: string }[]) {
      known.set(row.item_id, row.content_hash);
    }

    const stale: VectorItem[] = [];
    let reused = 0;
    for (const item of items) {
      if (known.get(item.id) === contentHash(item.text)) reused += 1;
      else stale.push(item);
    }

    if (opts.prune) {
      const present = new Set(items.map((i) => i.id));
      for (const id of known.keys()) {
        if (!present.has(id)) deleteMissing.run(kind, embedder.modelId, id);
      }
      hot.delete(kind);
    }

    if (!stale.length) {
      stats.reused += reused;
      return { reused, embedded: 0, semanticAvailable: true };
    }

    let embedded = 0;
    try {
      for (let i = 0; i < stale.length; i += batchSize) {
        const batch = stale.slice(i, i + batchSize);
        stats.embedCalls += 1;
        const vectors = await embedder.embed(batch.map((b) => b.text));
        if (!Array.isArray(vectors) || vectors.length !== batch.length) {
          throw new Error(`embedder returned ${vectors?.length ?? 0} vectors for ${batch.length} texts`);
        }
        const ts = now();
        for (let j = 0; j < batch.length; j += 1) {
          const vec = normalize(vectors[j] ?? []);
          if (!vec.length) continue;
          upsert.run(
            kind,
            batch[j].id,
            embedder.modelId,
            contentHash(batch[j].text),
            vec.length,
            vectorToBlob(vec),
            ts,
          );
          embedded += 1;
        }
      }
    } catch (err) {
      // Partial progress is kept on purpose: whatever did land is still valid
      // and still reusable next tick, so a flaky model makes the cache warm up
      // slowly rather than never.
      hot.delete(kind);
      stats.embedded += embedded;
      stats.reused += reused;
      return {
        reused,
        embedded,
        semanticAvailable: false,
        reason: `embedding failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }

    hot.delete(kind);
    stats.embedded += embedded;
    stats.reused += reused;
    return { reused, embedded, semanticAvailable: true };
  }

  /** Embed one query string. Separated so callers can reuse a vector across kinds. */
  async function embedQuery(text: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      stats.embedCalls += 1;
      const [vec] = await embedder.embed([trimmed]);
      if (!Array.isArray(vec) || !vec.length) return null;
      return normalize(vec);
    } catch {
      return null;
    }
  }

  /**
   * Top-`k` items of `kind` by cosine similarity to `query`.
   *
   * `query` may be raw text (embedded here) or an already-computed vector —
   * the vector form matters when ranking one arrival against four corpora,
   * where re-embedding the same query four times would quadruple the only
   * genuinely expensive step.
   */
  async function search(
    kind: string,
    query: string | readonly number[],
    k = 10,
    opts: { minScore?: number } = {},
  ): Promise<VectorSearchResult> {
    const vec = typeof query === 'string' ? await embedQuery(query) : normalize([...query]);
    if (!vec) {
      return { hits: [], semanticAvailable: false, reason: 'query could not be embedded' };
    }
    const map = loadKind(kind);
    if (map.size === 0) {
      return { hits: [], semanticAvailable: false, reason: `no vectors indexed for kind '${kind}'` };
    }
    const min = opts.minScore ?? -Infinity;
    const hits: VectorHit[] = [];
    for (const [id, v] of map) {
      const score = dot(vec, v);
      if (score >= min) hits.push({ id, score });
    }
    hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return { hits: hits.slice(0, k), semanticAvailable: true };
  }

  return {
    modelId: embedder.modelId,
    warm,
    search,
    embedQuery,
    /** Drop the in-memory cache for a kind (or all). Disk rows survive. */
    invalidate(kind?: string) {
      if (kind) hot.delete(kind);
      else hot.clear();
    },
    /** Counters for `pd doctor` / the metrics surface. */
    stats: () => ({ ...stats, kinds: hot.size }),
    /** How many vectors exist for a kind, without loading them. */
    count(kind: string): number {
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM pd_vectors WHERE kind = ? AND model_id = ?`)
        .get(kind, embedder.modelId) as { n: number } | undefined;
      return row?.n ?? 0;
    },
  };
}

export type VectorStore = ReturnType<typeof createVectorStore>;

// ─── fusion ──────────────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion constant, matching `lib/durable-agent-roster.ts`.
 *
 * Kept identical on purpose: two rankers in the same product that fuse with
 * different constants produce subtly different orderings for the same inputs,
 * and nobody ever tracks down why.
 */
export const RRF_K = 60;

/**
 * Fuse ranked id lists by reciprocal rank.
 *
 * RRF rather than score averaging because the two tiers are not commensurable:
 * BM25 scores are unbounded and corpus-dependent while cosine sits in [-1, 1],
 * so any weighted sum silently lets one tier dominate depending on corpus size.
 * RRF only reads *position*, which is the part both tiers agree means something.
 */
export function reciprocalRankFusion(
  rankings: ReadonlyArray<readonly string[]>,
  k: number = RRF_K,
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, index) => {
      fused.set(id, (fused.get(id) ?? 0) + 1 / (k + index + 1));
    });
  }
  return fused;
}
