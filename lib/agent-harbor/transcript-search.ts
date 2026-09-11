/**
 * Agent Harbor Transcript Search (binder ch04 "Transcript search and
 * blackboard"; ch07 M6 gate; ADR-0097 phase 2, roadmap slug
 * adr-0097-phase-2-transcript-search).
 *
 * Hybrid (BM25 + dense embedding, RRF-fused) search over the append-only
 * event ledger (lib/agent-harbor/event-ledger.ts, Work Order C1). Consumes
 * the frozen M6 contracts:
 *   - schemas/agent-harbor/v0/transcript-search-query.schema.json
 *   - schemas/agent-harbor/v0/transcript-search-result.schema.json
 * and validates BOTH the incoming query and the outgoing result against them
 * at runtime (fail-closed, same pattern as compliance-probe / cost-accrual).
 *
 * Normative rules implemented here (ADR-0097):
 *   - CITATION RULE: every hit carries >= 1 citation back to the specific
 *     ledger event it was drawn from. A search result is NEVER a bare answer;
 *     this engine emits no synthesized `answer` at all in v0 — hits + citations
 *     only.
 *   - BUDGET RULE: every query carries an explicit retrieval budget; the
 *     result echoes configured vs used with an explicit `truncated` flag, so
 *     "memory retrieval never exceeds configured budget" is auditable per
 *     response.
 *   - MODE RULE: default posture is hybrid (lexical BM25 + dense MiniLM with
 *     reciprocal rank fusion). Lexical-only is an explicit opt-in mode —
 *     when hybrid/semantic is requested and the shared local embedder is
 *     unavailable, the engine FAILS with EmbedderUnavailableError instead of
 *     silently degrading to lexical.
 *   - REDACTION: events with redactionState redacted/quarantined or a
 *     redacted visibility class are never indexed, so redacted payloads can
 *     never leak through snippets. Query-time visibility ceilings filter the
 *     rest.
 *   - FRESHNESS: the search index is a disposable projection over the ledger
 *     (the log is sacred). Results carry the C-routes freshness envelope
 *     (stale / lastLedgerSeq / headSeq); stale results are labeled, never
 *     hidden.
 *
 * Search mechanism policy (repo AGENTS.md, "Never ship lexical-only search";
 * non-negotiable): NO keyword-list / substring matching. The lexical leg is
 * BM25 (Okapi, k1=1.2 b=0.75) and the
 * dense leg reuses the ONE shared local embedder
 * (Xenova/all-MiniLM-L6-v2 via lib/semantic-resolver.ts createLocalEmbedder —
 * the same model `pd embed` fronts; ADR-0061). No per-feature model, no
 * remote service.
 *
 * Skill grafts honored (cited in the PR):
 *   - rag-retrieval-pattern-design: hybrid BM25 + dense with RRF (k=60),
 *     retrieve-then-budget, honest empty results, snippet windows.
 *   - clip-aware-embeddings: embeddings for semantic similarity ranking only —
 *     never classification or counting; cosine on normalized vectors is a dot
 *     product.
 *   - database-design-patterns: the index is one denormalized read-model table
 *     with covering indexes on the scoped columns, rebuilt from the normalized
 *     source of truth (the ledger); idempotent DDL + INSERT OR IGNORE.
 *   - agent-interchange-formats: tolerant reader (unknown query fields ride
 *     along; unknown event kinds index like any other), canonical join keys
 *     (agentNodeId / sessionId / runId), self-identifying `schema` consts.
 */

import type { DatabaseInstance } from '../sqlite-runtime.js';
import type { LocalEmbedder } from '../semantic-resolver.js';
import {
  localTextCorpusPolicy,
  selectEmbeddingProfile,
  type CorpusPolicy,
} from '../retrieval-policy.js';
import {
  admitRetrievalDerivative,
  admitRetrievalQuery,
  type RetrievalAdmissionOptions,
} from '../retrieval-admission.js';
import { assertEmbeddingBatchConforms } from '../embedding-runtime-conformance.js';
import { ensureEventLedgerSchema, ledgerHeadSeq } from './event-ledger.js';
import { assertAgainstSchema } from './schema-validate.js';

// ─────────────────────────────────────────────────────────────────────────────
// Errors (fail-closed, honest)
// ─────────────────────────────────────────────────────────────────────────────

/** Hybrid/semantic requested but no embedder available — never silently degrade. */
export class EmbedderUnavailableError extends Error {
  code = 'EMBEDDER_UNAVAILABLE' as const;
  constructor(mode: string) {
    super(
      `mode "${mode}" needs the shared local embedding model and none is available. ` +
      'Run: pd embed prefetch — or explicitly opt into degraded lexical search with mode "lexical". ' +
      'Silent lexical fallback is forbidden by the M6 contract (transcript-search-query MODE RULE).',
    );
  }
}

/** A requested corpus this v0 engine cannot search — refusing beats silently dropping it. */
export class UnsupportedSearchSourceError extends Error {
  code = 'UNSUPPORTED_SEARCH_SOURCE' as const;
  constructor(source: string) {
    super(
      `source "${source}" is not searchable in this v0 engine (supported: ${SUPPORTED_SOURCES.join(', ')}). ` +
      'A search that silently ignored a requested corpus would be dishonest — narrow `sources` explicitly.',
    );
  }
}

/** A scope narrowing this v0 engine cannot honor — returning broader results would be wrong. */
export class UnsupportedScopeError extends Error {
  code = 'UNSUPPORTED_SCOPE' as const;
  constructor(field: string) {
    super(
      `scope.${field} is not filterable in this v0 engine — refusing rather than returning ` +
      'results broader than the requested scope.',
    );
  }
}

/** The transcript pilot never searches an implicit cross-harbor corpus. */
export class MissingSearchScopeError extends Error {
  code = 'MISSING_SEARCH_SCOPE' as const;
  constructor(field: string) {
    super(`scope.${field} is required; transcript retrieval is default-deny across scope boundaries`);
  }
}

/** A caller supplied an embedder authorized for a different corpus. */
export class SearchPolicyMismatchError extends Error {
  code = 'SEARCH_POLICY_MISMATCH' as const;
  constructor() {
    super('transcript retrieval embedder policy does not match the transcript corpus');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract-facing types (tolerant-reader mirrors of the frozen v0 schemas)
// ─────────────────────────────────────────────────────────────────────────────

export const SUPPORTED_SOURCES = ['transcript-events', 'receipts'] as const;
export type SearchSource = (typeof SUPPORTED_SOURCES)[number];
export const TRANSCRIPT_SEARCH_CORPUS_ID = 'pd.agent-harbor.memory' as const;

export type SearchMode = 'hybrid' | 'semantic' | 'lexical';

export interface TranscriptSearchQuery {
  schema: 'pd.agent-harbor.transcript-search-query.v0';
  queryId: string;
  issuedAt: string;
  issuedBy: { kind: 'operator' | 'agent' | 'longshoreman' | 'daemon'; agentNodeId?: string | null; sessionId?: string | null };
  queryText: string;
  mode: SearchMode;
  scope?: {
    harborId?: string | null;
    projectId?: string | null;
    repoRef?: string | null;
    agentNodeIds?: string[];
    sessionIds?: string[];
    eventKinds?: string[];
    occurredAfter?: string | null;
    occurredBefore?: string | null;
  };
  sources: string[];
  budget: { maxResults: number; maxContextTokens?: number | null; maxLatencyMs?: number | null };
  retrievalHints?: { fusion?: 'rrf' | null; rerank?: boolean; recencyWeight?: number };
  visibilityCeiling?: 'operator' | 'agent' | 'system' | null;
  [key: string]: unknown;
}

export interface SearchCitation {
  kind: 'transcript-event';
  transcriptEventId: string;
  sessionId?: string;
}

export interface SearchHit {
  rank: number;
  score: number;
  source: SearchSource;
  snippet: string | null;
  agentNodeId: string | null;
  sessionId: string | null;
  runId: string | null;
  occurredAt: string | null;
  citations: SearchCitation[];
}

export interface TranscriptSearchResult {
  schema: 'pd.agent-harbor.transcript-search-result.v0';
  queryId: string;
  completedAt: string;
  engine: {
    mode: SearchMode;
    corpusId: string;
    corpusPolicyDigest: string;
    queryAdmissionReceiptId: string;
    embeddingModel: string | null;
    embeddingSpaceId: string | null;
    fusion: 'rrf' | null;
    rrfK: number | null;
    reranked: boolean;
  };
  budget: {
    configured: { maxResults: number; maxContextTokens: number | null };
    used: { results: number; contextTokensEstimate: number };
    truncated: boolean;
  };
  hits: SearchHit[];
  projection: { stale: boolean; lastLedgerSeq: number; headSeq: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Index schema (disposable read model; the ledger is the truth)
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_INDEX_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS harbor_search_index (
    event_id        TEXT PRIMARY KEY,
    ledger_seq      INTEGER NOT NULL,
    source          TEXT NOT NULL,
    corpus_id       TEXT NOT NULL,
    session_id      TEXT,
    agent_node_id   TEXT,
    run_id          TEXT,
    kind            TEXT,
    occurred_at     TEXT,
    visibility      TEXT NOT NULL DEFAULT 'operator',
    harbor_id       TEXT NOT NULL,
    repo_ref        TEXT NOT NULL,
    text            TEXT NOT NULL,
    token_count     INTEGER NOT NULL,
    source_digest   TEXT NOT NULL,
    derivative_digest TEXT NOT NULL,
    redaction_receipt_id TEXT NOT NULL,
    redaction_policy_id TEXT NOT NULL,
    retention_policy_id TEXT NOT NULL,
    admission_receipt_json TEXT NOT NULL,
    embedding_json  TEXT,
    embedding_model TEXT,
    embedding_space_id TEXT,
    embedding_policy_digest TEXT,
    embedding_production_receipt_id TEXT
  );

  CREATE TABLE IF NOT EXISTS harbor_search_meta (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    last_ledger_seq INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT
  );
`;

const SEARCH_INDEX_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_hsi_session ON harbor_search_index(session_id);
  CREATE INDEX IF NOT EXISTS idx_hsi_node ON harbor_search_index(agent_node_id);
  CREATE INDEX IF NOT EXISTS idx_hsi_seq ON harbor_search_index(ledger_seq);
  CREATE INDEX IF NOT EXISTS idx_hsi_scope
    ON harbor_search_index(corpus_id, harbor_id, repo_ref, source, visibility);
  CREATE INDEX IF NOT EXISTS idx_hsi_kind ON harbor_search_index(kind);
  CREATE INDEX IF NOT EXISTS idx_hsi_occurred ON harbor_search_index(occurred_at);
`;

const REQUIRED_SEARCH_INDEX_COLUMNS = [
  'event_id',
  'ledger_seq',
  'source',
  'corpus_id',
  'text',
  'token_count',
  'visibility',
  'harbor_id',
  'repo_ref',
  'source_digest',
  'derivative_digest',
  'redaction_receipt_id',
  'redaction_policy_id',
  'retention_policy_id',
  'admission_receipt_json',
  'embedding_json',
  'embedding_model',
  'embedding_space_id',
  'embedding_policy_digest',
  'embedding_production_receipt_id',
] as const;

export function ensureSearchIndexSchema(db: DatabaseInstance): void {
  ensureEventLedgerSchema(db);
  db.exec(SEARCH_INDEX_TABLES_SQL);
  let columns = db.prepare('PRAGMA table_info(harbor_search_index)').all() as Array<{ name: string }>;
  let present = new Set(columns.map((column) => column.name));
  const isLegacy = REQUIRED_SEARCH_INDEX_COLUMNS.some((column) => !present.has(column));
  if (isLegacy) {
    // This table is a disposable projection. Rows without exact scope,
    // sanitization lineage, policy, and space identity are rebuilt from the
    // ledger instead of being relabeled as trustworthy.
    db.exec('DROP TABLE harbor_search_index; DROP TABLE harbor_search_meta;');
    db.exec(SEARCH_INDEX_TABLES_SQL);
    columns = db.prepare('PRAGMA table_info(harbor_search_index)').all() as Array<{ name: string }>;
    present = new Set(columns.map((column) => column.name));
  }
  db.exec(SEARCH_INDEX_INDEXES_SQL);
  for (const required of REQUIRED_SEARCH_INDEX_COLUMNS) {
    if (!present.has(required)) {
      throw new Error(`harbor_search_index migration verification failed: missing column ${required}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction (redaction-aware; tolerant reader)
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED_STATES = new Set(['redacted', 'quarantined']);
const REDACTED_VISIBILITY = new Set(['private-redacted', 'secret-redacted']);
/** Fields whose values are hashes/discriminators, useless as search text. */
const SKIP_KEYS = new Set(['schema', 'contentHash', 'prevHash', 'schemaVersion']);
const MAX_STRING_CHARS = 2_000;
const MAX_TEXT_CHARS = 4_000;

/** Recursively collect string leaves from a payload (bounded, key-order stable). */
function collectStrings(value: unknown, out: string[], budget: { chars: number }): void {
  if (budget.chars <= 0) return;
  if (typeof value === 'string') {
    if (value.length === 0) return;
    const clipped = value.slice(0, Math.min(MAX_STRING_CHARS, budget.chars));
    out.push(clipped);
    budget.chars -= clipped.length;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, budget);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      if (SKIP_KEYS.has(key)) continue;
      collectStrings(sub, out, budget);
    }
  }
}

/** Extract indexable text from a ledger payload. Returns null when redacted. */
export function extractSearchText(payload: Record<string, unknown>): string | null {
  const redaction = typeof payload.redactionState === 'string' ? payload.redactionState : 'none';
  if (REDACTED_STATES.has(redaction)) return null;
  const visibility = typeof payload.visibility === 'string' ? payload.visibility : 'operator';
  if (REDACTED_VISIBILITY.has(visibility)) return null;
  const parts: string[] = [];
  if (typeof payload.kind === 'string') parts.push(payload.kind);
  const budget = { chars: MAX_TEXT_CHARS };
  collectStrings(payload.payloadJson ?? null, parts, budget);
  // Receipts and other non-transcript payloads carry their prose at top level.
  if (payload.payloadJson === undefined) {
    const { eventId: _e, ...rest } = payload;
    collectStrings(rest, parts, budget);
  }
  const text = parts.join(' ').trim();
  return text.length > 0 ? text : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Incremental indexing (checkpointed; idempotent via INSERT OR IGNORE)
// ─────────────────────────────────────────────────────────────────────────────

export interface IndexResult {
  indexed: number;
  skippedRedacted: number;
  skippedUnscoped: number;
  sanitized: number;
  embedded: number;
  fromSeq: number;
  toSeq: number;
}

export interface SearchIndexOptions {
  readonly policy?: CorpusPolicy;
  readonly admission?: RetrievalAdmissionOptions;
}

function assertTranscriptEmbedder(embedder: LocalEmbedder): void {
  if (embedder.policy.corpusId !== TRANSCRIPT_SEARCH_CORPUS_ID || embedder.role !== 'text_dense') {
    throw new SearchPolicyMismatchError();
  }
  const selected = selectEmbeddingProfile(embedder.policy, embedder.role).profile;
  if (
    embedder.profile.spaceId !== embedder.spaceId
    || embedder.profile.modelId !== embedder.modelId
    || selected.spaceId !== embedder.spaceId
  ) {
    throw new SearchPolicyMismatchError();
  }
}

interface LedgerSourceRow {
  ledger_seq: number;
  event_id: string;
  stream_type: string;
  agent_node_id: string | null;
  session_id: string | null;
  run_id: string | null;
  kind: string | null;
  occurred_at: string | null;
  payload_json: string;
}

const STREAM_TO_SOURCE: Record<string, SearchSource> = {
  'transcript-event': 'transcript-events',
  'work-receipt': 'receipts',
};

function getCheckpoint(db: DatabaseInstance): number {
  const row = db.prepare('SELECT last_ledger_seq FROM harbor_search_meta WHERE id = 1').get() as
    | { last_ledger_seq: number }
    | undefined;
  return row?.last_ledger_seq ?? 0;
}

function setCheckpoint(db: DatabaseInstance, seq: number): void {
  db.prepare(
    `INSERT INTO harbor_search_meta (id, last_ledger_seq, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_ledger_seq = excluded.last_ledger_seq, updated_at = excluded.updated_at`,
  ).run(seq, new Date().toISOString());
}

/**
 * Index every searchable ledger event past the checkpoint. Text-only —
 * embeddings are filled separately by embedPending so lexical search never
 * waits on a model download.
 */
export function indexPending(
  db: DatabaseInstance,
  options: SearchIndexOptions = {},
): Omit<IndexResult, 'embedded'> {
  ensureSearchIndexSchema(db);
  const policy = options.policy ?? localTextCorpusPolicy(TRANSCRIPT_SEARCH_CORPUS_ID);
  if (policy.corpusId !== TRANSCRIPT_SEARCH_CORPUS_ID) throw new SearchPolicyMismatchError();
  const fromSeq = getCheckpoint(db);
  const head = ledgerHeadSeq(db);
  let indexed = 0;
  let skippedRedacted = 0;
  let skippedUnscoped = 0;
  let sanitized = 0;
  const PAGE = 5_000;
  let after = fromSeq;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO harbor_search_index (
       event_id, ledger_seq, source, corpus_id, session_id, agent_node_id, run_id, kind,
       occurred_at, visibility, harbor_id, repo_ref, text, token_count,
       source_digest, derivative_digest, redaction_receipt_id, redaction_policy_id,
       retention_policy_id, admission_receipt_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  while (after < head) {
    const rows = db
      .prepare(
        `SELECT ledger_seq, event_id, stream_type, agent_node_id, session_id, run_id,
                kind, occurred_at, payload_json
         FROM harbor_events
         WHERE ledger_seq > ? AND stream_type IN ('transcript-event', 'work-receipt')
         ORDER BY ledger_seq ASC LIMIT ?`,
      )
      .all(after, PAGE) as LedgerSourceRow[];
    for (const row of rows) {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(row.payload_json) as Record<string, unknown>;
      } catch {
        continue; // tolerant reader: an unparseable payload is unsearchable, not fatal
      }
      const text = extractSearchText(payload);
      if (text === null) {
        skippedRedacted += 1;
        continue;
      }
      const visibility = typeof payload.visibility === 'string' ? payload.visibility : 'operator';
      const harborId = typeof payload.harborId === 'string' ? payload.harborId.trim() : '';
      if (!harborId) {
        skippedUnscoped += 1;
        continue;
      }
      const repoRef = typeof payload.repoRef === 'string' ? payload.repoRef.trim() : '';
      if (!repoRef) {
        skippedUnscoped += 1;
        continue;
      }
      const admitted = admitRetrievalDerivative({
        sourceId: row.event_id,
        sourceContent: row.payload_json,
        text,
        harborId,
        repoRef,
        policy,
      }, options.admission);
      if (admitted.receipt.state === 'redacted') sanitized += 1;
      const info = insert.run(
        row.event_id,
        row.ledger_seq,
        STREAM_TO_SOURCE[row.stream_type],
        policy.corpusId,
        row.session_id,
        row.agent_node_id,
        row.run_id,
        row.kind,
        row.occurred_at,
        visibility,
        harborId,
        repoRef,
        admitted.text,
        tokenize(admitted.text).length,
        admitted.receipt.sourceDigest,
        admitted.receipt.derivativeDigest,
        admitted.receipt.receiptId,
        admitted.receipt.redactionPolicyId,
        admitted.receipt.retentionPolicyId,
        JSON.stringify(admitted.receipt),
      );
      if (info.changes > 0) indexed += 1;
    }
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].ledger_seq;
  }
  setCheckpoint(db, head);
  return { indexed, skippedRedacted, skippedUnscoped, sanitized, fromSeq, toSeq: head };
}

/**
 * Fill in dense vectors for indexed rows that lack one under this embedder's
 * model. Uses the ONE shared local embedder (ADR-0061) — callers inject it so
 * tests never download a model and production reuses pd embed's cache.
 */
export async function embedPending(db: DatabaseInstance, embedder: LocalEmbedder): Promise<number> {
  ensureSearchIndexSchema(db);
  assertTranscriptEmbedder(embedder);
  const productionReceipt = await embedder.conformance();
  if (productionReceipt.spaceId !== embedder.spaceId || productionReceipt.modelId !== embedder.modelId) {
    throw new SearchPolicyMismatchError();
  }
  const BATCH = 32;
  let embedded = 0;
  const update = db.prepare(
    `UPDATE harbor_search_index
        SET embedding_json = ?, embedding_model = ?, embedding_space_id = ?,
            embedding_policy_digest = ?, embedding_production_receipt_id = ?
      WHERE event_id = ?`,
  );
  for (;;) {
    const rows = db
      .prepare(
        `SELECT event_id, text FROM harbor_search_index
         WHERE corpus_id = ? AND (
           embedding_json IS NULL
           OR embedding_space_id IS NOT ?
           OR embedding_policy_digest IS NOT ?
           OR embedding_production_receipt_id IS NOT ?
         )
         ORDER BY ledger_seq ASC LIMIT ?`,
      )
      .all(
        embedder.policy.corpusId,
        embedder.spaceId,
        embedder.policy.policyDigest,
        productionReceipt.receiptDigest,
        BATCH,
      ) as Array<{ event_id: string; text: string }>;
    if (rows.length === 0) break;
    const vectors = await embedder.embed(rows.map((r) => r.text));
    assertEmbeddingBatchConforms(embedder.profile, vectors, rows.length);
    for (let i = 0; i < rows.length; i += 1) {
      update.run(
        JSON.stringify(vectors[i]),
        embedder.modelId,
        embedder.spaceId,
        embedder.policy.policyDigest,
        productionReceipt.receiptDigest,
        rows[i].event_id,
      );
      embedded += 1;
    }
  }
  return embedded;
}

/** Drop and rebuild the whole index from the ledger. The log is sacred; this is disposable. */
export async function rebuildSearchIndex(
  db: DatabaseInstance,
  options: { embedder?: LocalEmbedder | null; policy?: CorpusPolicy; admission?: RetrievalAdmissionOptions } = {},
): Promise<IndexResult> {
  ensureSearchIndexSchema(db);
  db.exec('DELETE FROM harbor_search_index; DELETE FROM harbor_search_meta;');
  const base = indexPending(db, { policy: options.policy ?? options.embedder?.policy, admission: options.admission });
  const embedded = options.embedder ? await embedPending(db, options.embedder) : 0;
  return { ...base, embedded };
}

// ─────────────────────────────────────────────────────────────────────────────
// BM25 (Okapi) — the lexical leg. Ranking function, not keyword matching.
// ─────────────────────────────────────────────────────────────────────────────

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

interface IndexRow {
  event_id: string;
  ledger_seq: number;
  source: SearchSource;
  corpus_id: string;
  session_id: string | null;
  agent_node_id: string | null;
  run_id: string | null;
  kind: string | null;
  occurred_at: string | null;
  visibility: string;
  harbor_id: string | null;
  repo_ref: string | null;
  text: string;
  token_count: number;
  embedding_json: string | null;
  embedding_model: string | null;
  embedding_space_id: string | null;
  embedding_policy_digest: string | null;
  embedding_production_receipt_id: string | null;
}

/** BM25 over the scoped candidate set; corpus statistics are computed per query scope. */
function bm25Rank(rows: IndexRow[], queryTokens: string[]): Array<{ row: IndexRow; score: number }> {
  const n = rows.length;
  if (n === 0 || queryTokens.length === 0) return [];
  const avgDl = rows.reduce((sum, r) => sum + Math.max(1, r.token_count), 0) / n;
  const docTokens = rows.map((r) => {
    const tf = new Map<string, number>();
    for (const tok of tokenize(r.text)) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    return tf;
  });
  const uniqueQuery = [...new Set(queryTokens)];
  const df = new Map<string, number>();
  for (const term of uniqueQuery) {
    let count = 0;
    for (const tf of docTokens) if (tf.has(term)) count += 1;
    df.set(term, count);
  }
  const scored: Array<{ row: IndexRow; score: number }> = [];
  for (let i = 0; i < n; i += 1) {
    let score = 0;
    const dl = Math.max(1, rows[i].token_count);
    for (const term of uniqueQuery) {
      const f = docTokens[i].get(term) ?? 0;
      if (f === 0) continue;
      const nDf = df.get(term) ?? 0;
      const idf = Math.log(1 + (n - nDf + 0.5) / (nDf + 0.5));
      score += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgDl))));
    }
    if (score > 0) scored.push({ row: rows[i], score });
  }
  scored.sort((a, b) => b.score - a.score || b.row.ledger_seq - a.row.ledger_seq);
  return scored;
}

/** Cosine over L2-normalized vectors is a dot product; clamped to >= 0 for the contract. */
function denseRank(
  rows: IndexRow[],
  queryVector: number[],
  embedder: LocalEmbedder,
  productionReceiptId: string,
): Array<{ row: IndexRow; score: number }> {
  const scored: Array<{ row: IndexRow; score: number }> = [];
  for (const row of rows) {
    if (
      !row.embedding_json
      || row.embedding_model !== embedder.modelId
      || row.embedding_space_id !== embedder.spaceId
      || row.embedding_policy_digest !== embedder.policy.policyDigest
      || row.embedding_production_receipt_id !== productionReceiptId
    ) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding_json) as number[];
    } catch {
      continue;
    }
    if (!Array.isArray(vec) || vec.length !== queryVector.length || vec.some((value) => !Number.isFinite(value))) {
      continue;
    }
    let dot = 0;
    for (let i = 0; i < vec.length; i += 1) dot += vec[i] * queryVector[i];
    if (dot > 0) scored.push({ row, score: dot });
  }
  scored.sort((a, b) => b.score - a.score || b.row.ledger_seq - a.row.ledger_seq);
  return scored;
}

/** Reciprocal rank fusion, k = 60 (rag-retrieval-pattern-design). */
const RRF_K = 60;

function rrfFuse(
  lists: Array<Array<{ row: IndexRow; score: number }>>,
): Array<{ row: IndexRow; score: number }> {
  const byId = new Map<string, { row: IndexRow; score: number }>();
  for (const list of lists) {
    list.forEach(({ row }, idx) => {
      const rank = idx + 1;
      const contribution = 1 / (RRF_K + rank);
      const existing = byId.get(row.event_id);
      if (existing) existing.score += contribution;
      else byId.set(row.event_id, { row, score: contribution });
    });
  }
  return [...byId.values()].sort((a, b) => b.score - a.score || b.row.ledger_seq - a.row.ledger_seq);
}

// ─────────────────────────────────────────────────────────────────────────────
// Visibility ceilings — redacted classes were never indexed; this filters the rest
// ─────────────────────────────────────────────────────────────────────────────

const VISIBILITY_ALLOWED: Record<'operator' | 'agent' | 'system', Set<string>> = {
  operator: new Set(['operator', 'agent', 'system', 'internal']),
  agent: new Set(['agent', 'system']),
  system: new Set(['system']),
};

function resolveCeiling(query: TranscriptSearchQuery): 'operator' | 'agent' | 'system' {
  if (query.visibilityCeiling) return query.visibilityCeiling;
  return query.issuedBy.kind === 'operator' ? 'operator' : 'agent';
}

// ─────────────────────────────────────────────────────────────────────────────
// Snippets and token budgets
// ─────────────────────────────────────────────────────────────────────────────

const SNIPPET_CHARS = 240;

/** Rough token estimate — chars/4 for English (rag-retrieval-pattern-design). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Window the text around the first query-token occurrence. */
function makeSnippet(text: string, queryTokens: string[]): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const tok of queryTokens) {
    const idx = lower.indexOf(tok);
    if (idx >= 0 && (at === -1 || idx < at)) at = idx;
  }
  if (at < 0) return text.slice(0, SNIPPET_CHARS);
  const start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 2));
  const snippet = text.slice(start, start + SNIPPET_CHARS);
  return (start > 0 ? '…' : '') + snippet;
}

// ─────────────────────────────────────────────────────────────────────────────
// The search entrypoint
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchOptions {
  /** The shared local embedder (semantic-resolver createLocalEmbedder) or a test double. */
  embedder?: LocalEmbedder | null;
  /** Index pending ledger events (and vectors, when the mode needs them) before searching. Default true. */
  autoIndex?: boolean;
  /** Dual-scanner and clock injection for pre-retrieval admission. */
  admission?: RetrievalAdmissionOptions;
}

/**
 * Execute a TranscriptSearchQuery against the ledger-backed index and return
 * a contract-valid TranscriptSearchResult. Both sides are schema-validated
 * fail-closed; every hit is cited to the ledger event it came from.
 */
export async function searchTranscripts(
  db: DatabaseInstance,
  query: TranscriptSearchQuery,
  options: SearchOptions = {},
): Promise<TranscriptSearchResult> {
  assertAgainstSchema('transcript-search-query', query);

  for (const source of query.sources) {
    if (!(SUPPORTED_SOURCES as readonly string[]).includes(source)) {
      throw new UnsupportedSearchSourceError(source);
    }
  }
  const scope = query.scope ?? {};
  if (scope.projectId) throw new UnsupportedScopeError('projectId');
  const harborId = scope.harborId?.trim();
  if (!harborId) throw new MissingSearchScopeError('harborId');
  const repoRef = scope.repoRef?.trim();
  if (!repoRef) throw new MissingSearchScopeError('repoRef');

  const mode = query.mode;
  const embedder = options.embedder ?? null;
  if ((mode === 'hybrid' || mode === 'semantic') && !embedder) {
    throw new EmbedderUnavailableError(mode);
  }
  const policy = embedder?.policy ?? localTextCorpusPolicy(TRANSCRIPT_SEARCH_CORPUS_ID);
  if (policy.corpusId !== TRANSCRIPT_SEARCH_CORPUS_ID) throw new SearchPolicyMismatchError();
  if (embedder) assertTranscriptEmbedder(embedder);
  if (mode === 'lexical' && !policy.allowLexicalFallback) {
    throw new SearchPolicyMismatchError();
  }
  const admittedQuery = admitRetrievalQuery({
    queryId: query.queryId,
    queryText: query.queryText,
    harborId,
    repoRef,
    policy,
  }, options.admission);

  ensureSearchIndexSchema(db);
  const autoIndex = options.autoIndex !== false;
  if (autoIndex) {
    indexPending(db, { policy, admission: options.admission });
    if (embedder && mode !== 'lexical') await embedPending(db, embedder);
  }

  // Scoped candidate set (SQL narrows; ranking happens in memory).
  const where: string[] = [];
  const params: unknown[] = [];
  where.push('corpus_id = ?');
  params.push(policy.corpusId);
  where.push('harbor_id = ?');
  params.push(harborId);
  where.push('redaction_policy_id = ?');
  params.push(policy.redactionPolicyId);
  where.push('retention_policy_id = ?');
  params.push(policy.retentionPolicyId);
  where.push('repo_ref = ?');
  params.push(repoRef);
  where.push(`source IN (${query.sources.map(() => '?').join(', ')})`);
  params.push(...query.sources);
  const ceiling = resolveCeiling(query);
  const allowed = [...VISIBILITY_ALLOWED[ceiling]];
  where.push(`visibility IN (${allowed.map(() => '?').join(', ')})`);
  params.push(...allowed);
  if (scope.sessionIds && scope.sessionIds.length > 0) {
    where.push(`session_id IN (${scope.sessionIds.map(() => '?').join(', ')})`);
    params.push(...scope.sessionIds);
  }
  if (scope.agentNodeIds && scope.agentNodeIds.length > 0) {
    where.push(`agent_node_id IN (${scope.agentNodeIds.map(() => '?').join(', ')})`);
    params.push(...scope.agentNodeIds);
  }
  if (scope.eventKinds && scope.eventKinds.length > 0) {
    where.push(`kind IN (${scope.eventKinds.map(() => '?').join(', ')})`);
    params.push(...scope.eventKinds);
  }
  if (scope.occurredAfter) {
    where.push('occurred_at >= ?');
    params.push(scope.occurredAfter);
  }
  if (scope.occurredBefore) {
    where.push('occurred_at <= ?');
    params.push(scope.occurredBefore);
  }
  const rows = db
    .prepare(`SELECT * FROM harbor_search_index WHERE ${where.join(' AND ')}`)
    .all(...params) as IndexRow[];

  // Rank.
  const queryTokens = tokenize(admittedQuery.text);
  let ranked: Array<{ row: IndexRow; score: number }>;
  let embeddingModel: string | null = null;
  let embeddingSpaceId: string | null = null;
  let fusion: 'rrf' | null = null;
  if (mode === 'lexical') {
    ranked = bm25Rank(rows, queryTokens);
  } else {
    const productionReceipt = await embedder!.conformance();
    if (productionReceipt.spaceId !== embedder!.spaceId || productionReceipt.modelId !== embedder!.modelId) {
      throw new SearchPolicyMismatchError();
    }
    const queryVectors = await embedder!.embed([admittedQuery.text]);
    assertEmbeddingBatchConforms(embedder!.profile, queryVectors, 1);
    const queryVector = queryVectors[0];
    embeddingModel = embedder!.modelId;
    embeddingSpaceId = embedder!.spaceId;
    const dense = denseRank(rows, queryVector, embedder!, productionReceipt.receiptDigest);
    if (mode === 'semantic') {
      ranked = dense;
    } else {
      fusion = 'rrf';
      ranked = rrfFuse([bm25Rank(rows, queryTokens), dense]);
    }
  }

  // Budget: maxResults slices; maxContextTokens trims snippets (citations always survive).
  const maxResults = query.budget.maxResults;
  const maxContextTokens = query.budget.maxContextTokens ?? null;
  const matched = ranked.length;
  const kept = ranked.slice(0, maxResults);
  let contextTokens = 0;
  let snippetsDropped = false;
  const hits: SearchHit[] = kept.map(({ row, score }, idx) => {
    let snippet: string | null = makeSnippet(row.text, queryTokens);
    if (maxContextTokens !== null) {
      const cost = estimateTokens(snippet);
      if (contextTokens + cost > maxContextTokens) {
        snippet = null;
        snippetsDropped = true;
      } else {
        contextTokens += cost;
      }
    } else {
      contextTokens += estimateTokens(snippet);
    }
    const citation: SearchCitation = { kind: 'transcript-event', transcriptEventId: row.event_id };
    if (row.session_id) citation.sessionId = row.session_id;
    return {
      rank: idx + 1,
      score,
      source: row.source,
      snippet,
      agentNodeId: row.agent_node_id,
      sessionId: row.session_id,
      runId: row.run_id,
      occurredAt: row.occurred_at,
      citations: [citation],
    };
  });

  const head = ledgerHeadSeq(db);
  const checkpoint = getCheckpoint(db);
  const result: TranscriptSearchResult = {
    schema: 'pd.agent-harbor.transcript-search-result.v0',
    queryId: query.queryId,
    completedAt: new Date().toISOString(),
    engine: {
      mode,
      corpusId: policy.corpusId,
      corpusPolicyDigest: policy.policyDigest,
      queryAdmissionReceiptId: admittedQuery.receipt.receiptId,
      embeddingModel,
      embeddingSpaceId,
      fusion,
      rrfK: fusion === 'rrf' ? RRF_K : null,
      reranked: false,
    },
    budget: {
      configured: { maxResults, maxContextTokens },
      used: { results: hits.length, contextTokensEstimate: contextTokens },
      truncated: matched > hits.length || snippetsDropped,
    },
    hits,
    projection: { stale: checkpoint < head, lastLedgerSeq: checkpoint, headSeq: head },
  };
  assertAgainstSchema('transcript-search-result', result);
  return result;
}
