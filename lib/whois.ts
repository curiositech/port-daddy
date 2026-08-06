/**
 * Whois — Semantic Phonebook over the Existing Resolver
 *
 * `pd whois <query>` is the routing primitive that turns Port Daddy's
 * registration substrate (harbor capabilities + agent skills + heartbeats)
 * into an answer to "which agent do I send this work to?".
 *
 * Architecture
 * ────────────
 * - Capability phrases enter via `harbor_members.capabilities` (already a
 *   first-class registration surface). When a harbor write happens we
 *   embed each phrase via the shared semantic resolver and persist to a
 *   small sidecar table: `harbor_member_capability_embeddings`.
 * - Queries flow through a deterministic cascade:
 *     1. Exact phrase match  (similarity 1.0)
 *     2. BM25 over the phrase corpus (top 20 candidates)
 *     3. Cosine over candidate embeddings (rerank)
 *     4. LLM tiebreak only when top-2 cosine is within `TIEBREAK_MARGIN`
 *
 * Freshness gate (from the brief, anchor:
 *  docs/ROADMAP.md §8 + .scratch/agent-coordination-research.md §2.3):
 *   - last heartbeat ≤ 30 min  → weight 1.0
 *   - 30 min < hb ≤ 24 h       → exp decay
 *   - 24 h < hb ≤ 7 d          → 0.1 floor
 *   - hb > 7 d                  → excluded
 *
 * The cascade is intentionally a single canonical pattern. No regex
 * fallbacks. The rule from CLAUDE.md/feedback applies: no keyword-list
 * NLP at the route level.
 */

import { analyze } from './lexical-index.js';
import type Database from 'better-sqlite3';
import type { SemanticResolver } from './semantic-resolver.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Heartbeat window during which an agent is considered fully fresh. */
const FRESH_WINDOW_MS = 30 * 60 * 1000;          // 30 min — weight 1.0
/** End of the exponential-decay window. Past this we floor. */
const DECAY_HORIZON_MS = 24 * 60 * 60 * 1000;    // 24 h
/** Past `DECAY_HORIZON_MS`, results drop to a 0.1 floor. */
const STALE_FLOOR_WEIGHT = 0.1;
/** Past this point an agent is excluded from default whois results. */
const HARD_CUTOFF_MS = 7 * 24 * 60 * 60 * 1000;  // 7 d

/** Top-K phrases the BM25 stage forwards to cosine rerank. */
const BM25_CANDIDATE_LIMIT = 20;
/** Cosine difference within which we consider top-2 a tie. */
const TIEBREAK_MARGIN = 0.02;

// ─── Types ───────────────────────────────────────────────────────────────────

export type WhoisKind = 'agent' | 'human' | 'any';

/** Source of the capability claim. Matches the research-doc taxonomy. */
export type WhoisSource = 'declared' | 'inferred' | 'earned';

/** A capability-phrase row that was matched by the cascade. */
export interface WhoisHit {
  /** Agent ID resolved by the phonebook. */
  agentId: string;
  /** Agent display name when available. */
  agentName: string | null;
  /** Harbor name where this capability phrase was declared. */
  harbor: string;
  /** The phrase that matched. */
  phrase: string;
  /** Composite ranker score in [0, 1]; higher is better. */
  score: number;
  /** Raw cosine similarity (or 1.0 for exact match). */
  similarity: number;
  /** BM25 score that promoted this phrase to the rerank stage, when used. */
  bm25Score: number | null;
  /** Freshness weight applied. [0.1, 1.0] for stale-but-eligible agents. */
  freshnessWeight: number;
  /** ms since epoch of the agent's last heartbeat, or null when unknown. */
  lastHeartbeat: number | null;
  /** Which stage of the cascade ultimately ranked this hit. */
  stage: 'exact' | 'bm25' | 'semantic' | 'llm';
  /** Provenance — kept simple in v1 (always 'declared'). */
  source: WhoisSource;
}

/** Search options. */
export interface WhoisSearchOptions {
  /** Filter by entity kind. v1 only persists agents; 'human' returns []. */
  kind?: WhoisKind;
  /** Minimum freshness in seconds (overrides default 7 d cutoff). */
  freshMinSeconds?: number;
  /** Cap the response. Defaults to 10. */
  limit?: number;
  /** Override the wall clock — tests pin time for deterministic decay. */
  nowMs?: number;
  /**
   * Optional pluggable LLM tiebreak. Returns the ranked agent IDs from
   * `candidates`. Only consulted when top-2 cosine within TIEBREAK_MARGIN.
   * If omitted the cosine order is left untouched.
   */
  llmTiebreak?: (
    query: string,
    candidates: WhoisHit[],
  ) => Promise<string[]>;
}

/** Public Whois API. */
export interface Whois {
  /**
   * Persist capability phrases for an (agent, harbor) pair. Embeds each
   * phrase via the shared resolver and writes a row into the sidecar.
   *
   * Idempotent — re-registering the same phrase refreshes `created_at`.
   */
  registerCapabilities(
    agentId: string,
    harbor: string,
    phrases: readonly string[],
  ): Promise<{ inserted: number; phrases: string[] }>;

  /**
   * Run the cascade ranker against the phrase corpus.
   *
   * Returns up to `limit` ranked hits.
   */
  search(query: string, opts?: WhoisSearchOptions): Promise<WhoisHit[]>;

  /**
   * Backfill the sidecar from existing `harbor_members.capabilities`.
   * Returns the count of newly-embedded (agent, harbor, phrase) triples.
   *
   * Idempotent — safe to run on every daemon start.
   */
  backfill(): Promise<{ embedded: number; scanned: number }>;
}

// ─── BM25 (tiny implementation, no external deps) ─────────────────────────────

/**
 * Tokenizer used by the BM25 stage and the exact-match stage. Lowercases,
 * splits on non-alphanumeric, drops 1-char tokens. Deliberately boring —
 * BM25's strength is robustness, not cleverness.
 */
function tokenize(text: string): string[] {
  // Shared Unicode-safe analyzer — see lib/lexical-index.ts. Replaces an
  // ASCII-only split that deleted every non-Latin term from whois search.
  // No .slice(): analyze() already returns a fresh array and filter() does not
  // mutate, so the copy was a per-query allocation buying nothing.
  return analyze(text).filter((token) => token.length > 1);
}

interface CorpusEntry {
  rowId: number;
  agentId: string;
  harbor: string;
  phrase: string;
  embedding: Float32Array;
  tokens: string[];
}

/**
 * BM25 score for a query against a single document.
 *
 * Why BM25 (and not TF-IDF or substring match): BM25 is the canonical lexical
 * ranker for short documents, gives sane scores without tuning, and matches
 * the cascade-research doc verbatim.
 */
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

// ─── Vector helpers ──────────────────────────────────────────────────────────

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

/**
 * Encode/decode embeddings as Float32Array BLOBs. Far more compact than
 * JSON arrays and the format matches what the resolver returns.
 */
function vectorToBlob(vector: number[]): Buffer {
  const f32 = new Float32Array(vector);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function blobToVector(blob: Buffer): Float32Array {
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

// ─── Freshness gate ──────────────────────────────────────────────────────────

/**
 * Translate a heartbeat timestamp into a freshness weight per the brief.
 * Visible state machine — exposed for tests.
 */
export function freshnessWeight(
  lastHeartbeat: number | null,
  nowMs: number,
): { weight: number; eligible: boolean } {
  if (lastHeartbeat === null) {
    return { weight: STALE_FLOOR_WEIGHT, eligible: true };
  }

  const age = Math.max(0, nowMs - lastHeartbeat);
  if (age <= FRESH_WINDOW_MS) return { weight: 1, eligible: true };
  if (age >= HARD_CUTOFF_MS) return { weight: 0, eligible: false };
  if (age >= DECAY_HORIZON_MS) return { weight: STALE_FLOOR_WEIGHT, eligible: true };

  const k = -Math.log(STALE_FLOOR_WEIGHT) / (DECAY_HORIZON_MS - FRESH_WINDOW_MS);
  const weight = Math.exp(-k * (age - FRESH_WINDOW_MS));
  return { weight, eligible: true };
}

// ─── Module factory ──────────────────────────────────────────────────────────

export interface WhoisDeps {
  /** Embedding source. Required. */
  resolver: Pick<SemanticResolver, 'embed' | 'modelId'>;
  /** Optional structured logger. */
  logger?: {
    info?(msg: string, meta?: Record<string, unknown>): void;
    error?(msg: string, meta?: Record<string, unknown>): void;
  };
}

interface CapabilityRow {
  rowid: number;
  harbor_name: string;
  agent_id: string;
  phrase: string;
  embedding: Buffer;
  created_at: number;
}

interface AgentMetaRow {
  id: string;
  name: string | null;
  last_heartbeat: number | null;
}

interface HarborMemberCapRow {
  harbor_name: string;
  agent_id: string;
  capabilities: string | null;
}

/**
 * Create the Whois service.
 *
 * Example:
 * ```ts
 * const whois = createWhois(db, { resolver: semanticResolver });
 * await whois.registerCapabilities('agent-42', 'port-daddy:fleet', [
 *   'frontend', 'typescript', 'react server components',
 * ]);
 * const hits = await whois.search('react expertise');
 * ```
 */
export function createWhois(db: Database.Database, deps: WhoisDeps): Whois {
  const { resolver, logger } = deps;

  db.exec(`
    CREATE TABLE IF NOT EXISTS harbor_member_capability_embeddings (
      harbor_name TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      phrase      TEXT NOT NULL,
      embedding   BLOB NOT NULL,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (harbor_name, agent_id, phrase)
    );

    CREATE INDEX IF NOT EXISTS idx_hmce_harbor_phrase
      ON harbor_member_capability_embeddings(harbor_name, phrase);

    CREATE INDEX IF NOT EXISTS idx_hmce_agent
      ON harbor_member_capability_embeddings(agent_id);
  `);

  const stmts = {
    upsert: db.prepare(`
      INSERT INTO harbor_member_capability_embeddings
        (harbor_name, agent_id, phrase, embedding, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(harbor_name, agent_id, phrase)
      DO UPDATE SET embedding = excluded.embedding,
                    created_at = excluded.created_at
    `),
    listAll: db.prepare(`
      SELECT rowid AS rowid, harbor_name, agent_id, phrase, embedding, created_at
      FROM harbor_member_capability_embeddings
    `),
    listMembers: db.prepare(`
      SELECT harbor_name, agent_id, capabilities
      FROM harbor_members
      WHERE capabilities IS NOT NULL AND capabilities != '' AND capabilities != '[]'
    `),
    existsPhrase: db.prepare(`
      SELECT 1 FROM harbor_member_capability_embeddings
      WHERE harbor_name = ? AND agent_id = ? AND phrase = ?
      LIMIT 1
    `),
    getAgentMeta: db.prepare(`
      SELECT id, name, last_heartbeat
      FROM agents
      WHERE id = ?
      LIMIT 1
    `),
  };

  async function registerCapabilities(
    agentId: string,
    harbor: string,
    phrases: readonly string[],
  ): Promise<{ inserted: number; phrases: string[] }> {
    if (!agentId || !harbor) return { inserted: 0, phrases: [] };
    const clean = Array.from(
      new Set(
        phrases
          .map((p) => (typeof p === 'string' ? p.trim() : ''))
          .filter((p) => p.length > 0),
      ),
    );
    if (clean.length === 0) return { inserted: 0, phrases: [] };

    let inserted = 0;
    for (const phrase of clean) {
      try {
        const vector = await resolver.embed(phrase);
        if (!vector.length) continue;
        stmts.upsert.run(harbor, agentId, phrase, vectorToBlob(vector), Date.now());
        inserted++;
      } catch (err) {
        logger?.error?.('whois_register_failed', {
          agentId, harbor, phrase, error: (err as Error).message,
        });
      }
    }
    return { inserted, phrases: clean };
  }

  function loadCorpus(): CorpusEntry[] {
    const rows = stmts.listAll.all() as CapabilityRow[];
    return rows.map((row) => ({
      rowId: row.rowid,
      agentId: row.agent_id,
      harbor: row.harbor_name,
      phrase: row.phrase,
      embedding: blobToVector(row.embedding),
      tokens: tokenize(row.phrase),
    }));
  }

  function getAgentMeta(agentId: string): AgentMetaRow | null {
    try {
      return (stmts.getAgentMeta.get(agentId) as AgentMetaRow | undefined) ?? null;
    } catch {
      return null;
    }
  }

  function attachAgent(
    hit: Omit<WhoisHit, 'agentName' | 'lastHeartbeat' | 'freshnessWeight' | 'score'>,
    nowMs: number,
  ): { hit: WhoisHit; eligible: boolean } {
    const meta = getAgentMeta(hit.agentId);
    const fresh = freshnessWeight(meta?.last_heartbeat ?? null, nowMs);
    const score = hit.similarity * fresh.weight;
    return {
      eligible: fresh.eligible,
      hit: {
        ...hit,
        agentName: meta?.name ?? null,
        lastHeartbeat: meta?.last_heartbeat ?? null,
        freshnessWeight: fresh.weight,
        score,
      },
    };
  }

  async function search(
    query: string,
    opts: WhoisSearchOptions = {},
  ): Promise<WhoisHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const kind = opts.kind ?? 'agent';
    if (kind === 'human') return [];

    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
    const nowMs = opts.nowMs ?? Date.now();
    const freshFloorMs = opts.freshMinSeconds
      ? Math.max(0, nowMs - opts.freshMinSeconds * 1000)
      : null;

    const corpus = loadCorpus();
    if (corpus.length === 0) return [];

    // Stage 1: exact phrase match (case-insensitive)
    const queryLower = trimmed.toLowerCase();
    const exactRaw = corpus.filter((entry) => entry.phrase.toLowerCase() === queryLower);
    const exactRanked: WhoisHit[] = [];
    for (const entry of exactRaw) {
      const { hit, eligible } = attachAgent({
        agentId: entry.agentId,
        harbor: entry.harbor,
        phrase: entry.phrase,
        similarity: 1.0,
        bm25Score: null,
        stage: 'exact',
        source: 'declared',
      }, nowMs);
      if (!eligible) continue;
      if (freshFloorMs !== null && (hit.lastHeartbeat ?? 0) < freshFloorMs) continue;
      exactRanked.push(hit);
    }
    if (exactRanked.length > 0) {
      exactRanked.sort((a, b) => b.score - a.score);
      return exactRanked.slice(0, limit);
    }

    // Stage 2: BM25 over the phrase corpus
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
    const corpusStats = {
      totalDocs: corpus.length,
      avgDocLen: totalLen / Math.max(1, corpus.length),
      docFreq,
    };

    const scored = corpus.map((entry) => ({
      entry,
      bm25: queryTokens.length > 0 ? bm25Score(queryTokens, entry, corpusStats) : 0,
    }));
    const positiveBM25 = scored
      .filter((s) => s.bm25 > 0)
      .sort((a, b) => b.bm25 - a.bm25)
      .slice(0, BM25_CANDIDATE_LIMIT);
    const candidates = positiveBM25.length > 0 ? positiveBM25 : scored;

    // Stage 3: cosine over the candidate embeddings
    const queryVector = await resolver.embed(trimmed);
    if (queryVector.length === 0) return [];

    const reranked = candidates.map(({ entry, bm25 }) => ({
      entry,
      bm25,
      similarity: dot(queryVector, entry.embedding),
    })).sort((a, b) => b.similarity - a.similarity);

    // Stage 4: LLM tiebreak (only on top-2 cosine within margin)
    const baseStage: WhoisHit['stage'] = positiveBM25.length > 0 ? 'bm25' : 'semantic';

    const hits: WhoisHit[] = [];
    for (const row of reranked) {
      const { hit, eligible } = attachAgent({
        agentId: row.entry.agentId,
        harbor: row.entry.harbor,
        phrase: row.entry.phrase,
        similarity: row.similarity,
        bm25Score: row.bm25 > 0 ? row.bm25 : null,
        stage: baseStage,
        source: 'declared',
      }, nowMs);
      if (!eligible) continue;
      if (freshFloorMs !== null && (hit.lastHeartbeat ?? 0) < freshFloorMs) continue;
      hits.push(hit);
    }
    hits.sort((a, b) => b.score - a.score);

    if (
      hits.length >= 2
      && Math.abs(hits[0].score - hits[1].score) < TIEBREAK_MARGIN
      && opts.llmTiebreak
    ) {
      try {
        const top = hits.slice(0, Math.min(hits.length, 5));
        const order = await opts.llmTiebreak(trimmed, top);
        if (Array.isArray(order) && order.length > 0) {
          const indexOf = new Map(order.map((id, i) => [id, i]));
          top.sort((a, b) => {
            const ai = indexOf.get(a.agentId) ?? Number.MAX_SAFE_INTEGER;
            const bi = indexOf.get(b.agentId) ?? Number.MAX_SAFE_INTEGER;
            return ai - bi;
          });
          for (let i = 0; i < top.length; i++) {
            top[i] = { ...top[i], stage: 'llm' };
            hits[i] = top[i];
          }
        }
      } catch (err) {
        logger?.error?.('whois_llm_tiebreak_failed', {
          query: trimmed, error: (err as Error).message,
        });
      }
    }

    return hits.slice(0, limit);
  }

  async function backfill(): Promise<{ embedded: number; scanned: number }> {
    let scanned = 0;
    let embedded = 0;

    let rows: HarborMemberCapRow[];
    try {
      rows = stmts.listMembers.all() as HarborMemberCapRow[];
    } catch {
      return { embedded: 0, scanned: 0 };
    }

    for (const row of rows) {
      scanned++;
      let phrases: string[] = [];
      try {
        const parsed = JSON.parse(row.capabilities ?? '[]') as unknown;
        if (Array.isArray(parsed)) {
          phrases = parsed.filter((p): p is string => typeof p === 'string');
        }
      } catch {
        continue;
      }
      const missing = phrases.filter((phrase) =>
        !stmts.existsPhrase.get(row.harbor_name, row.agent_id, phrase),
      );
      if (missing.length === 0) continue;
      const result = await registerCapabilities(row.agent_id, row.harbor_name, missing);
      embedded += result.inserted;
    }
    return { embedded, scanned };
  }

  return { registerCapabilities, search, backfill };
}

export type WhoisService = ReturnType<typeof createWhois>;
