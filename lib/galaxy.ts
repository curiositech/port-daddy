/**
 * Session Galaxy — a 2-D embedding map of recent agent sessions.
 *
 * One galaxy point = one `fleet_transcripts` row (lib/transcripts.ts). The
 * last-N-token tail of each transcript is embedded with the local MiniLM
 * encoder, clustered with seeded k-means (k chosen by silhouette), projected
 * with seeded t-SNE, and labeled with mutual-information terms computed over
 * the actual tails.
 *
 * Built on lib/transcripts.ts (fleet_transcripts) deliberately — NOT
 * lib/transcript-store.ts (transcript_events), which server.ts never
 * constructs; a galaxy over it would render an empty universe.
 *
 * Caching:
 *   - Per-tail embeddings persist in the `galaxy_embeddings` sqlite table,
 *     keyed (transcript_id, sha1(tail), model_id) — re-polling only embeds
 *     transcripts whose tails actually changed.
 *   - The whole map response is cached 30s per param-tuple, so pd-console's
 *     2s pane cadence and fleet-ui's 15s poll are cheap.
 *
 * Determinism: every stochastic step draws from mulberry32(seed) with
 * seed = 42 by default (injectable for tests). Same data + same params →
 * bitwise-identical map.
 */

import { createHash } from 'node:crypto';
import { relative as relativePath } from 'node:path';
import type Database from 'better-sqlite3';
import type { TranscriptEntry, TranscriptStatus, TranscriptsModule } from './transcripts.js';
import type { createSessions } from './sessions.js';
import {
  chooseK,
  clusterTerms,
  estimateTokensFromText,
  minMaxNormalize2d,
  mulberry32,
  tsne2d,
} from './galaxy-math.js';
import type { ClusterTerm } from './galaxy-math.js';

// =============================================================================
// Types (the Galaxy API contract)
// =============================================================================

type SessionsModule = ReturnType<typeof createSessions>;

export interface GalaxyEmbedder {
  modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

export interface GalaxyDeps {
  db: Database.Database;
  transcripts: TranscriptsModule;
  sessions: SessionsModule;
  embedder: GalaxyEmbedder;
  now?: () => number;
  seed?: number;
}

export interface GalaxyMapParams {
  windowHours?: number;
  tailTokens?: number;
  minTokens?: number;
  limit?: number;
  project?: string | null;
  /** Skip k-means clustering + MI labeling entirely when false (default true). */
  cluster?: boolean;
}

export interface GalaxyPoint {
  id: string;
  sessionId: string | null;
  agentId: string;
  ship: string | null;
  project: string | null;
  identity: string | null;
  purpose: string | null;
  status: TranscriptStatus;
  startedAt: number;
  endedAt: number | null;
  tailTokens: number;
  x: number;
  y: number;
  clusterId: number;
  snippet: string;
  prNumber: number | null;
}

export interface GalaxyCluster {
  id: number;
  label: string;
  terms: ClusterTerm[];
  size: number;
  centroid: [number, number];
}

export interface GalaxyMapResponse {
  success: true;
  computedAt: number;
  params: {
    windowHours: number;
    tailTokens: number;
    minTokens: number;
    limit: number;
    project: string | null;
    cluster: boolean;
  };
  points: GalaxyPoint[];
  clusters: GalaxyCluster[];
  stats: {
    sessionCount: number;
    embeddedNow: number;
    /** Legacy alias for embeddingCacheHits; kept so older clients do not drift. */
    cacheHits: number;
    embeddingCacheHits: number;
    responseCacheHits: number;
    elapsedMs: number;
  };
  /**
   * False when the embedder could not run, so this map is built only from
   * sessions whose vectors were already cached.
   *
   * **Why this exists.** The embed call used to be unguarded, so a MiniLM that
   * had not downloaded — or an onnxruntime the loader could not find, which is
   * fragile enough to need `ensureOnnxRuntimeNativeLibFindable()` — threw out
   * of the whole request. Sextant went blank and said nothing about why, which
   * is indistinguishable from "this fleet has done no work". A pane that is
   * empty because the model is missing must not look like a pane that is empty
   * because there is nothing to show.
   */
  embedderAvailable: boolean;
  /** Operator-facing reason when `embedderAvailable` is false. */
  degradedReason?: string;
}

export interface GalaxySessionDetail {
  transcript: TranscriptEntry;
  /** Epoch-ms — mirrors transcript.started_at, hoisted for click-through UIs. */
  startedAt: number;
  /** Epoch-ms, or null while the ship-run is still active. */
  endedAt: number | null;
  session: {
    id: string;
    purpose: string;
    status: string;
    phase: string | null;
    agentId: string | null;
    identityProject: string | null;
    createdAt: number;
    updatedAt: number;
    completedAt: number | null;
  } | null;
  notes: Array<{ id: string; content: string; type: string; createdAt: number }>;
  files: Array<{
    filePath: string;
    /** Original absolute path when the stored claim was absolute — lets a UI
     * build an editor deep link (vscode://file/<abs>) alongside the
     * repo-relative display path. Absent when the claim was already relative. */
    absolutePath?: string;
    startLine: number | null;
    endLine: number | null;
    symbol: string | null;
    claimedAt: number;
    releasedAt: number | null;
  }>;
  toolUses: Array<{ name: string; args: unknown; at: number }>;
  prs: Array<{ prNumber: number | null; url: string | null; type: string; summary: string }>;
}

export interface GalaxyModule {
  getMap(params?: GalaxyMapParams): Promise<GalaxyMapResponse>;
  getSessionDetail(id: string): GalaxySessionDetail | null;
}

// =============================================================================
// Defaults + clamps (daemon-owned; both UIs inherit by omitting params)
// =============================================================================

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_TAIL_TOKENS = 4000;
const MIN_TAIL_TOKENS = 256;
const MAX_TAIL_TOKENS = 16000;
const DEFAULT_MIN_TOKENS = 256;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 500;
const DEFAULT_SEED = 42;
const MAP_CACHE_TTL_MS = 30_000;
const SNIPPET_CHARS = 140;
/** ~200-token chunks (~800 chars) — MiniLM truncates at ~256 wordpieces, so a
 * long tail embedded raw would be silently cut off. Chunk, embed, average. */
const EMBED_CHUNK_CHARS = 800;
/** Types of transcript outputs surfaced as linked artifacts on the detail view. */
const PR_OUTPUT_TYPES = new Set(['pr-comment', 'draft-pr', 'commit', 'issue']);

// =============================================================================
// Implementation
// =============================================================================

/**
 * Best-effort absolute → repo-relative path normalization for the detail
 * files-touched list. Already-relative paths pass through untouched; absolute
 * paths outside the daemon's cwd (a different repo, a different worktree)
 * are left absolute rather than guessed at — "where derivable" only.
 */
function toRepoRelative(filePath: string): string {
  if (!filePath || !filePath.startsWith('/')) return filePath;
  const rel = relativePath(process.cwd(), filePath);
  if (rel === '' ) return '.';
  if (rel.startsWith('..')) return filePath; // outside the repo root — can't derive
  return rel;
}

export function createGalaxy(deps: GalaxyDeps): GalaxyModule {
  const { db, transcripts, sessions, embedder } = deps;
  const now = deps.now ?? Date.now;
  const seed = deps.seed ?? DEFAULT_SEED;

  db.prepare(`
    CREATE TABLE IF NOT EXISTS galaxy_embeddings (
      transcript_id TEXT NOT NULL,
      tail_hash TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dims INTEGER NOT NULL,
      vector BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (transcript_id, tail_hash, model_id),
      FOREIGN KEY (transcript_id) REFERENCES fleet_transcripts(id) ON DELETE CASCADE
    )
  `).run();

  const getEmbeddingStmt = db.prepare(`
    SELECT dims, vector FROM galaxy_embeddings
     WHERE transcript_id = ? AND tail_hash = ? AND model_id = ?
  `);
  const putEmbeddingStmt = db.prepare(`
    INSERT OR REPLACE INTO galaxy_embeddings (transcript_id, tail_hash, model_id, dims, vector, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  // Whole-response cache, keyed by the resolved param tuple.
  const mapCache = new Map<string, { at: number; response: GalaxyMapResponse }>();

  function sha1(text: string): string {
    return createHash('sha1').update(text).digest('hex');
  }

  function vectorToBuffer(vector: number[]): Buffer {
    return Buffer.from(new Float32Array(vector).buffer);
  }

  function bufferToVector(buffer: Buffer, dims: number): number[] {
    const floats = new Float32Array(buffer.buffer, buffer.byteOffset, dims);
    return Array.from(floats);
  }

  /**
   * Build the last-`tailTokens` tail of a transcript: walk messages from the
   * END, skip 'system' messages, accumulate until the budget is hit (the
   * oldest included message is truncated — keeping its most recent chars — to
   * fit), then join oldest→newest.
   */
  function buildTail(entry: TranscriptEntry, tailTokens: number): string {
    const included: string[] = [];
    let remaining = tailTokens;
    for (let i = entry.messages.length - 1; i >= 0 && remaining > 0; i--) {
      const msg = entry.messages[i];
      if (msg.role === 'system') continue;
      const content = msg.content ?? '';
      if (!content) continue;
      const tokens = estimateTokensFromText(content);
      if (tokens <= remaining) {
        included.push(content);
        remaining -= tokens;
      } else {
        // Truncate the oldest included message: keep its most recent chars.
        included.push(content.slice(content.length - remaining * 4));
        remaining = 0;
      }
    }
    included.reverse();
    return included.join('\n');
  }

  /** Chunk a tail into ~EMBED_CHUNK_CHARS pieces for the MiniLM window. */
  function chunkTail(tail: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < tail.length; i += EMBED_CHUNK_CHARS) {
      chunks.push(tail.slice(i, i + EMBED_CHUNK_CHARS));
    }
    return chunks.length > 0 ? chunks : [tail];
  }

  /** Average chunk vectors and renormalize to unit length. */
  function averageVectors(vectors: number[][]): number[] {
    const dims = vectors[0].length;
    const out = new Array<number>(dims).fill(0);
    for (const v of vectors) {
      for (let d = 0; d < dims; d++) out[d] += v[d];
    }
    for (let d = 0; d < dims; d++) out[d] /= vectors.length;
    let mag = 0;
    for (let d = 0; d < dims; d++) mag += out[d] * out[d];
    mag = Math.sqrt(mag);
    if (mag > 0) {
      for (let d = 0; d < dims; d++) out[d] /= mag;
    }
    return out;
  }

  function lookupPurpose(sessionId: string | null): string | null {
    if (!sessionId) return null;
    try {
      const result = sessions.get(sessionId) as {
        success: boolean;
        session?: { purpose?: string };
      };
      if (result.success && result.session && typeof result.session.purpose === 'string') {
        return result.session.purpose;
      }
    } catch {
      // Session enrichment is best-effort; identity fields still describe the point.
    }
    return null;
  }

  function resolveParams(params: GalaxyMapParams): GalaxyMapResponse['params'] {
    const windowHours = params.windowHours && params.windowHours > 0
      ? params.windowHours
      : DEFAULT_WINDOW_HOURS;
    const tailTokens = Math.min(
      MAX_TAIL_TOKENS,
      Math.max(MIN_TAIL_TOKENS, params.tailTokens ?? DEFAULT_TAIL_TOKENS),
    );
    const minTokens = params.minTokens && params.minTokens > 0
      ? params.minTokens
      : DEFAULT_MIN_TOKENS;
    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const project = typeof params.project === 'string' && params.project.trim().length > 0
      ? params.project.trim()
      : null;
    const cluster = params.cluster ?? true;
    return { windowHours, tailTokens, minTokens, limit, project, cluster };
  }

  async function getMap(rawParams: GalaxyMapParams = {}): Promise<GalaxyMapResponse> {
    const params = resolveParams(rawParams);
    const cacheKey = JSON.stringify(params);
    const cached = mapCache.get(cacheKey);
    const startedAt = now();
    if (cached && startedAt - cached.at < MAP_CACHE_TTL_MS) {
      return {
        ...cached.response,
        stats: {
          ...cached.response.stats,
          responseCacheHits: (cached.response.stats.responseCacheHits ?? 0) + 1,
        },
      };
    }

    const since = startedAt - params.windowHours * 3_600_000;

    // (1) Headers only — listTranscripts returns empty messages arrays. When a
    // project filter is active we over-fetch (the filter is post-hoc; the
    // transcripts list API has no project column filter) then trim to limit.
    let headers = transcripts.listTranscripts({
      since,
      limit: params.project ? 1000 : params.limit,
    });
    if (params.project) {
      headers = headers.filter((h) => h.project === params.project).slice(0, params.limit);
    }

    // (2) Full messages per row, tail + significance filter.
    const entries: Array<{ entry: TranscriptEntry; tail: string; tailTokens: number }> = [];
    for (const header of headers) {
      const entry = transcripts.getTranscript(header.id);
      if (!entry) continue;
      const tail = buildTail(entry, params.tailTokens);
      if (!tail) continue;
      const tokens = estimateTokensFromText(tail);
      if (tokens < params.minTokens) continue;
      entries.push({ entry, tail, tailTokens: tokens });
    }

    // (3) Embedding cache lookup + batch embed of misses.
    let embeddingCacheHits = 0;
    let embeddedNow = 0;
    // Honest degradation state for this map build. Flipped only when the
    // embedder itself fails — a fleet with nothing to show is NOT degraded.
    let embedderAvailable = true;
    let degradedReason: string | undefined;
    const vectors: Array<number[] | null> = new Array(entries.length).fill(null);
    const misses: Array<{ index: number; hash: string; chunks: string[] }> = [];
    for (let i = 0; i < entries.length; i++) {
      const { entry, tail } = entries[i];
      const hash = sha1(tail);
      const row = getEmbeddingStmt.get(entry.id, hash, embedder.modelId) as
        | { dims: number; vector: Buffer }
        | undefined;
      if (row) {
        vectors[i] = bufferToVector(row.vector, row.dims);
        embeddingCacheHits += 1;
      } else {
        misses.push({ index: i, hash, chunks: chunkTail(tail) });
      }
    }

    if (misses.length > 0) {
      const allChunks: string[] = [];
      for (const miss of misses) allChunks.push(...miss.chunks);
      // Degrade to whatever is already cached rather than failing the request.
      // A fleet that has embedded anything before still gets a usable map, and
      // one that has not gets an empty map that SAYS it is empty for want of a
      // model — not a 500 and not a silent blank pane.
      let chunkVectors: number[][];
      try {
        chunkVectors = await embedder.embed(allChunks);
      } catch (err) {
        embedderAvailable = false;
        degradedReason =
          `embedder '${embedder.modelId}' unavailable: ${(err as Error)?.message ?? String(err)}. ` +
          `Showing ${embeddingCacheHits} previously-embedded session(s) only. ` +
          `Run pd doctor to repair the local model.`;
        chunkVectors = [];
      }
      let cursor = 0;
      for (const miss of misses) {
        const own = chunkVectors.slice(cursor, cursor + miss.chunks.length);
        cursor += miss.chunks.length;
        if (own.length !== miss.chunks.length || own.length === 0) continue; // embedder shortfall — drop the point rather than misalign
        // Round through Float32 so the fresh-embed path and the sqlite-cache
        // path (BLOB stores Float32) produce bitwise-identical vectors — and
        // therefore bitwise-identical maps.
        const vector = Array.from(new Float32Array(averageVectors(own)));
        vectors[miss.index] = vector;
        putEmbeddingStmt.run(
          entries[miss.index].entry.id,
          miss.hash,
          embedder.modelId,
          vector.length,
          vectorToBuffer(vector),
          now(),
        );
        embeddedNow += 1;
      }
    }

    // Pair each entry with its vector; drop any that failed to embed so every
    // downstream array (coords, assignments, tails, points) stays aligned.
    const kept = entries
      .map((e, i) => ({ ...e, vector: vectors[i] }))
      .filter((e): e is typeof e & { vector: number[] } => e.vector !== null);
    const embedded = kept.map((e) => e.vector);
    const P = embedded.length;

    let points: GalaxyPoint[] = [];
    let clusters: GalaxyCluster[] = [];

    if (P > 0) {
      // (4) Seeded t-SNE on the full embeddings → normalized [0,1] map space.
      // Positions are always computed — `cluster=false` opts out of the
      // clustering/labeling step below, not of the map layout itself.
      const coords = minMaxNormalize2d(tsne2d(embedded, { seed }));

      // (5) Cluster the FULL-dimensional embeddings (opt-out via params.cluster),
      // then reindex cluster ids by size desc (0 = biggest) so colors are
      // stable-ish across polls. Skipping this entirely means every point is
      // clusterId 0 and no MI-term labeling work happens.
      let clusterIds = new Array<number>(P).fill(0);
      clusters = [];

      if (params.cluster) {
        const { k, assignments } = chooseK(embedded, mulberry32(seed));
        const sizes = new Array<number>(Math.max(1, k)).fill(0);
        for (const c of assignments) sizes[c] += 1;
        const order = sizes
          .map((size, id) => ({ id, size }))
          .sort((a, b) => b.size - a.size || a.id - b.id);
        const remap = new Array<number>(order.length).fill(0);
        order.forEach(({ id }, newId) => { remap[id] = newId; });
        const reindexed = assignments.map((c) => remap[c]);
        const effectiveK = Math.max(1, k);
        clusterIds = reindexed;

        // (6) MI term descriptors over the actual tails.
        const tails = kept.map((e) => e.tail);
        const termsPerCluster = clusterTerms(tails, reindexed, effectiveK);

        for (let c = 0; c < effectiveK; c++) {
          const memberIndices = reindexed
            .map((cluster, i) => ({ cluster, i }))
            .filter((m) => m.cluster === c)
            .map((m) => m.i);
          if (memberIndices.length === 0) continue;
          let cx = 0;
          let cy = 0;
          for (const i of memberIndices) {
            cx += coords[i][0];
            cy += coords[i][1];
          }
          cx /= memberIndices.length;
          cy /= memberIndices.length;
          const terms = termsPerCluster[c] ?? [];
          const label = terms.length > 0
            ? terms.slice(0, 3).map((t) => t.term).join(' · ')
            : `cluster ${c}`;
          clusters.push({
            id: c,
            label,
            terms,
            size: memberIndices.length,
            centroid: [cx, cy],
          });
        }
      }

      // (7) + (8) Assemble points with best-effort session purpose join.
      points = kept.map(({ entry, tail, tailTokens }, i) => ({
        id: entry.id,
        sessionId: entry.session_id ?? null,
        agentId: entry.spawned_agent_id,
        ship: entry.ship ?? null,
        project: entry.project ?? null,
        identity: entry.identity ?? null,
        purpose: lookupPurpose(entry.session_id ?? null),
        status: entry.status,
        startedAt: entry.started_at,
        endedAt: entry.ended_at ?? null,
        tailTokens,
        x: coords[i][0],
        y: coords[i][1],
        clusterId: clusterIds[i],
        snippet: tail.slice(0, SNIPPET_CHARS),
        prNumber: entry.pr_number ?? null,
      }));
    }

    const computedAt = now();
    const response: GalaxyMapResponse = {
      success: true,
      computedAt,
      params,
      points,
      clusters,
      stats: {
        sessionCount: points.length,
        embeddedNow,
        cacheHits: embeddingCacheHits,
        embeddingCacheHits,
        responseCacheHits: 0,
        elapsedMs: computedAt - startedAt,
      },
      embedderAvailable,
      ...(degradedReason ? { degradedReason } : {}),
    };

    mapCache.set(cacheKey, { at: computedAt, response });
    // Bound the cache: drop expired tuples so long-lived daemons with varied
    // param exploration don't accumulate stale entries.
    for (const [key, value] of mapCache) {
      if (computedAt - value.at >= MAP_CACHE_TTL_MS) mapCache.delete(key);
    }

    return response;
  }

  function getSessionDetail(id: string): GalaxySessionDetail | null {
    const transcript = transcripts.getTranscript(id);
    if (!transcript) return null;

    let session: GalaxySessionDetail['session'] = null;
    let notes: GalaxySessionDetail['notes'] = [];
    let files: GalaxySessionDetail['files'] = [];
    if (transcript.session_id) {
      try {
        const result = sessions.get(transcript.session_id) as {
          success: boolean;
          session?: Record<string, unknown>;
          notes?: Array<Record<string, unknown>>;
          files?: Array<Record<string, unknown>>;
        };
        if (result.success && result.session) {
          const s = result.session;
          session = {
            id: String(s.id),
            purpose: String(s.purpose ?? ''),
            status: String(s.status ?? ''),
            phase: (s.phase as string | null) ?? null,
            agentId: (s.agentId as string | null) ?? null,
            identityProject: (s.identityProject as string | null) ?? null,
            createdAt: Number(s.createdAt ?? 0),
            updatedAt: Number(s.updatedAt ?? 0),
            completedAt: (s.completedAt as number | null) ?? null,
          };
          notes = (result.notes ?? []).map((n) => ({
            id: String(n.id),
            content: String(n.content ?? ''),
            type: String(n.type ?? 'note'),
            createdAt: Number(n.createdAt ?? 0),
          }));
          files = (result.files ?? []).map((f) => ({
            filePath: toRepoRelative(String(f.filePath)),
            ...(String(f.filePath).startsWith('/') ? { absolutePath: String(f.filePath) } : {}),
            startLine: (f.startLine as number | null) ?? null,
            endLine: (f.endLine as number | null) ?? null,
            symbol: (f.symbol as string | null) ?? null,
            claimedAt: Number(f.claimedAt ?? 0),
            releasedAt: (f.releasedAt as number | null) ?? null,
          }));
        }
      } catch {
        // Session join is best-effort — the transcript itself is the record.
      }
    }

    const toolUses: GalaxySessionDetail['toolUses'] = [];
    for (const msg of transcript.messages) {
      if (!msg.tool_calls) continue;
      for (const tc of msg.tool_calls) {
        toolUses.push({ name: tc.name, args: tc.args, at: msg.timestamp });
      }
    }

    // PR provenance is best-effort (the spawner's default output is often just
    // message/noop) — absence of entries here does NOT mean no PRs were made.
    const prs: GalaxySessionDetail['prs'] = [];
    if (transcript.pr_number != null) {
      prs.push({
        prNumber: transcript.pr_number,
        url: null,
        type: 'pr',
        summary: `PR #${transcript.pr_number} recorded on transcript`,
      });
    }
    for (const output of transcript.outputs) {
      if (!PR_OUTPUT_TYPES.has(output.type)) continue;
      prs.push({
        prNumber: null,
        url: output.url ?? null,
        type: output.type,
        summary: output.summary,
      });
    }

    return {
      transcript,
      startedAt: transcript.started_at,
      endedAt: transcript.ended_at ?? null,
      session,
      notes,
      files,
      toolUses,
      prs,
    };
  }

  return { getMap, getSessionDetail };
}

export type Galaxy = ReturnType<typeof createGalaxy>;
