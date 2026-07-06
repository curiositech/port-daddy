/**
 * Agent Harbor transcript search tests (binder ch04 "Transcript search and
 * blackboard"; ch07 M6 gate; ADR-0097 phase 2).
 *
 * Gates covered here:
 *   - every hit is CITED to a specific ledger event (never a bare answer);
 *   - both the query and the result validate against the frozen M6 v0
 *     contracts (transcript-search-query / transcript-search-result);
 *   - retrieval never exceeds the configured budget, and truncation is an
 *     explicit flag, not silence;
 *   - scope filters (sessionIds / agentNodeIds / eventKinds) narrow the corpus;
 *   - hybrid/semantic without an embedder FAILS — lexical-only is an explicit
 *     opt-in, never a silent fallback (MODE RULE);
 *   - redacted payloads are never indexed and never leak through snippets;
 *   - results carry the C-routes freshness envelope (stale labeled, not hidden);
 *   - indexing is idempotent (replay-safe over the append-only ledger).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { appendEvent, type HarborPayload } from '../../lib/agent-harbor/event-ledger.js';
import { validateAgainstSchema } from '../../lib/agent-harbor/schema-validate.js';
import type { LocalEmbedder } from '../../lib/semantic-resolver.js';
import {
  EmbedderUnavailableError,
  UnsupportedSearchSourceError,
  UnsupportedScopeError,
  indexPending,
  embedPending,
  rebuildSearchIndex,
  searchTranscripts,
  tokenize,
  extractSearchText,
  type TranscriptSearchQuery,
} from '../../lib/agent-harbor/transcript-search.js';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic test embedder — a stand-in for the shared MiniLM model
// (Xenova/all-MiniLM-L6-v2). Buckets tokens into a 64-dim vector and
// L2-normalizes, so texts sharing vocabulary land close in cosine space.
// This is a test double for the embedding PLUMBING, not a semantic model.
// ─────────────────────────────────────────────────────────────────────────────

function bucketVector(text: string): number[] {
  const dims = 64;
  const v = new Array<number>(dims).fill(0);
  for (const tok of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i += 1) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dims] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const fakeEmbedder: LocalEmbedder = {
  modelId: 'test/bucket-64',
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(bucketVector);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Ledger seeding — two sessions, two agents, distinct vocabularies
// ─────────────────────────────────────────────────────────────────────────────

const NODE_A = 'agent_node_01SEARCHA';
const NODE_B = 'agent_node_01SEARCHB';
const SESSION_A = 'session_01SEARCHA';
const SESSION_B = 'session_01SEARCHB';

let seqA = 0;
let seqB = 0;

function transcriptA(kind: string, payloadJson: Record<string, unknown>, extra: HarborPayload = {}): HarborPayload {
  seqA += 1;
  return {
    eventId: `evt_a_${seqA}`,
    sessionId: SESSION_A,
    agentNodeId: NODE_A,
    sequence: seqA,
    occurredAt: `2026-07-05T10:0${Math.min(9, seqA)}:00.000Z`,
    schemaVersion: 1,
    kind,
    visibility: 'operator',
    payloadJson,
    ...extra,
  };
}

function transcriptB(kind: string, payloadJson: Record<string, unknown>, extra: HarborPayload = {}): HarborPayload {
  seqB += 1;
  return {
    eventId: `evt_b_${seqB}`,
    sessionId: SESSION_B,
    agentNodeId: NODE_B,
    sequence: seqB,
    occurredAt: `2026-07-05T11:0${Math.min(9, seqB)}:00.000Z`,
    schemaVersion: 1,
    kind,
    visibility: 'operator',
    payloadJson,
    ...extra,
  };
}

function seed(db: DatabaseInstance): void {
  seqA = 0;
  seqB = 0;
  // Session A: the "email ingress worker deploy" story.
  appendEvent(db, { streamType: 'transcript-event', payload: transcriptA('session_started', {}) });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptA('shell_command', {
      command: 'wrangler deploy pd-email-ingress --env production',
      cwd: '/repo/workers/email-ingress',
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptA('assistant_message', {
      text: 'Deployed the email ingress worker to Cloudflare via wrangler with the OAuth token, not the repo token.',
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptA('file_write', { path: 'workers/email-ingress/wrangler.toml' }),
  });
  // A redacted secret event — must NEVER surface in search.
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptA(
      'tool_result',
      { text: 'CLOUDFLARE_SECRET_TOKEN_VALUE_XYZZY deploy credentials' },
      { redactionState: 'redacted', visibility: 'secret-redacted' },
    ),
  });
  // Session B: an unrelated database migration story.
  appendEvent(db, { streamType: 'transcript-event', payload: transcriptB('session_started', {}) });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptB('shell_command', {
      command: 'psql -f supabase/migrations/079_add_index.sql',
    }),
  });
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: transcriptB('assistant_message', {
      text: 'Ran the postgres migration directly with psql because migration repair does not execute SQL.',
    }),
  });
}

function baseQuery(overrides: Partial<TranscriptSearchQuery> = {}): TranscriptSearchQuery {
  return {
    schema: 'pd.agent-harbor.transcript-search-query.v0',
    queryId: 'tsq_test_1',
    issuedAt: '2026-07-06T00:00:00.000Z',
    issuedBy: { kind: 'operator', agentNodeId: null, sessionId: null },
    queryText: 'how did we deploy the email ingress worker',
    mode: 'lexical',
    sources: ['transcript-events'],
    budget: { maxResults: 10 },
    ...overrides,
  };
}

describe('agent-harbor transcript search (M6, ADR-0097 phase 2)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    seed(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('the query fixture itself validates against the frozen contract', () => {
    const check = validateAgainstSchema('transcript-search-query', baseQuery());
    expect(check.skipped).toBe(false);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
  });

  it('lexical (BM25) search returns ranked hits, each cited to a real ledger event', async () => {
    const result = await searchTranscripts(db, baseQuery());
    expect(result.hits.length).toBeGreaterThan(0);
    // Top hit should be from the deploy story, not the migration story.
    expect(result.hits[0].sessionId).toBe(SESSION_A);
    for (const hit of result.hits) {
      expect(hit.citations.length).toBeGreaterThanOrEqual(1);
      for (const citation of hit.citations) {
        expect(citation.kind).toBe('transcript-event');
        const row = db
          .prepare('SELECT event_id FROM harbor_events WHERE event_id = ?')
          .get(citation.transcriptEventId);
        expect(row).toBeDefined(); // the citation resolves to a REAL ledger event
      }
    }
    // Ranks are 1..n in order.
    result.hits.forEach((hit, i) => expect(hit.rank).toBe(i + 1));
  });

  it('the result validates against the frozen transcript-search-result contract', async () => {
    const result = await searchTranscripts(db, baseQuery());
    const check = validateAgainstSchema('transcript-search-result', result);
    expect(check.skipped).toBe(false);
    expect(check.errors).toEqual([]);
    expect(check.valid).toBe(true);
    expect(result.schema).toBe('pd.agent-harbor.transcript-search-result.v0');
    expect(result.queryId).toBe('tsq_test_1');
  });

  it('never returns a bare synthesized answer — v0 emits hits only', async () => {
    const result = await searchTranscripts(db, baseQuery());
    expect((result as Record<string, unknown>).answer).toBeUndefined();
  });

  it('BUDGET RULE: maxResults is never exceeded and truncation is an explicit flag', async () => {
    const result = await searchTranscripts(db, baseQuery({ budget: { maxResults: 1 } }));
    expect(result.hits.length).toBe(1);
    expect(result.budget.configured.maxResults).toBe(1);
    expect(result.budget.used.results).toBe(1);
    expect(result.budget.truncated).toBe(true); // more matches existed
    const roomy = await searchTranscripts(db, baseQuery({ budget: { maxResults: 100 } }));
    expect(roomy.budget.truncated).toBe(false);
  });

  it('BUDGET RULE: maxContextTokens trims snippets but citations always survive', async () => {
    const result = await searchTranscripts(
      db,
      baseQuery({ budget: { maxResults: 10, maxContextTokens: 15 } }),
    );
    expect(result.budget.used.contextTokensEstimate).toBeLessThanOrEqual(15);
    // At least one later hit lost its snippet to the budget…
    expect(result.hits.some((h) => h.snippet === null)).toBe(true);
    expect(result.budget.truncated).toBe(true);
    // …but every hit still carries its citation.
    for (const hit of result.hits) {
      expect(hit.citations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('scopes by sessionId and agentNodeId (canonical join keys)', async () => {
    const bySession = await searchTranscripts(
      db,
      baseQuery({ queryText: 'command', scope: { sessionIds: [SESSION_B] } }),
    );
    expect(bySession.hits.length).toBeGreaterThan(0);
    for (const hit of bySession.hits) expect(hit.sessionId).toBe(SESSION_B);

    const byAgent = await searchTranscripts(
      db,
      baseQuery({ queryText: 'command', scope: { agentNodeIds: [NODE_A] } }),
    );
    expect(byAgent.hits.length).toBeGreaterThan(0);
    for (const hit of byAgent.hits) expect(hit.agentNodeId).toBe(NODE_A);
  });

  it('scopes by event kind', async () => {
    const result = await searchTranscripts(
      db,
      baseQuery({ queryText: 'wrangler deploy psql', scope: { eventKinds: ['shell_command'] } }),
    );
    expect(result.hits.length).toBeGreaterThan(0);
    // Kind scope: every citation resolves to a shell_command row.
    for (const hit of result.hits) {
      const row = db
        .prepare('SELECT kind FROM harbor_events WHERE event_id = ?')
        .get(hit.citations[0].transcriptEventId) as { kind: string };
      expect(row.kind).toBe('shell_command');
    }
  });

  it('MODE RULE: hybrid without an embedder fails — no silent lexical fallback', async () => {
    await expect(searchTranscripts(db, baseQuery({ mode: 'hybrid' }))).rejects.toThrow(
      EmbedderUnavailableError,
    );
    await expect(searchTranscripts(db, baseQuery({ mode: 'semantic' }))).rejects.toThrow(
      EmbedderUnavailableError,
    );
  });

  it('hybrid mode fuses BM25 + dense with RRF and reports the engine honestly', async () => {
    const result = await searchTranscripts(db, baseQuery({ mode: 'hybrid' }), {
      embedder: fakeEmbedder,
    });
    expect(result.engine.mode).toBe('hybrid');
    expect(result.engine.embeddingModel).toBe('test/bucket-64');
    expect(result.engine.fusion).toBe('rrf');
    expect(result.engine.reranked).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].sessionId).toBe(SESSION_A);
    const check = validateAgainstSchema('transcript-search-result', result);
    expect(check.valid).toBe(true);
  });

  it('semantic mode ranks by embedding similarity only', async () => {
    const result = await searchTranscripts(
      db,
      baseQuery({ mode: 'semantic', queryText: 'postgres migration psql' }),
      { embedder: fakeEmbedder },
    );
    expect(result.engine.mode).toBe('semantic');
    expect(result.engine.fusion).toBeNull();
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].sessionId).toBe(SESSION_B);
  });

  it('REDACTION: redacted payloads are never indexed and never leak through snippets', async () => {
    const stats = indexPending(db);
    expect(stats.skippedRedacted).toBeGreaterThanOrEqual(1);
    const result = await searchTranscripts(
      db,
      baseQuery({ queryText: 'CLOUDFLARE SECRET TOKEN XYZZY credentials', budget: { maxResults: 50 } }),
    );
    for (const hit of result.hits) {
      expect(hit.snippet ?? '').not.toContain('XYZZY');
      expect(hit.citations[0].transcriptEventId).not.toBe('evt_a_5');
    }
  });

  it('an empty result is an honest miss, still contract-valid', async () => {
    const result = await searchTranscripts(db, baseQuery({ queryText: 'zebra quokka nonexistent' }));
    expect(result.hits).toEqual([]);
    expect(result.budget.used.results).toBe(0);
    expect(result.budget.truncated).toBe(false);
    const check = validateAgainstSchema('transcript-search-result', result);
    expect(check.valid).toBe(true);
  });

  it('FRESHNESS: the projection envelope labels staleness instead of hiding it', async () => {
    // autoIndex keeps the index caught up → fresh.
    const fresh = await searchTranscripts(db, baseQuery());
    expect(fresh.projection.stale).toBe(false);
    expect(fresh.projection.lastLedgerSeq).toBe(fresh.projection.headSeq);
    // Append behind the index's back, search with autoIndex off → labeled stale.
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: transcriptA('assistant_message', { text: 'late-arriving deploy note' }),
    });
    const stale = await searchTranscripts(db, baseQuery(), { autoIndex: false });
    expect(stale.projection.stale).toBe(true);
    expect(stale.projection.lastLedgerSeq).toBeLessThan(stale.projection.headSeq!);
  });

  it('indexing is idempotent over the append-only ledger (replay-safe)', async () => {
    const first = indexPending(db);
    expect(first.indexed).toBeGreaterThan(0);
    const again = indexPending(db);
    expect(again.indexed).toBe(0); // nothing new; INSERT OR IGNORE + checkpoint
    const rebuilt = await rebuildSearchIndex(db, { embedder: fakeEmbedder });
    expect(rebuilt.indexed).toBe(first.indexed);
    expect(rebuilt.embedded).toBe(first.indexed);
    // embedPending is idempotent per model too.
    expect(await embedPending(db, fakeEmbedder)).toBe(0);
  });

  it('receipts source searches the work-receipt stream with ledger citations', async () => {
    appendEvent(db, {
      streamType: 'work-receipt',
      payload: {
        schema: 'pd.agent-harbor.work-receipt.v0',
        receiptId: 'receipt_search_1',
        agentNodeId: NODE_A,
        sessionId: SESSION_A,
        identity: { displayName: 'Deploy agent' },
        intent: { summary: 'Ship the email ingress worker to Cloudflare' },
        risks: [],
        validation: { commands: ['wrangler deploy'] },
        actions: [],
        contextUsed: {},
        rollback: { plan: 'wrangler rollback' },
        spend: {},
        provenance: {},
        createdAt: '2026-07-05T12:00:00.000Z',
      },
    });
    const result = await searchTranscripts(
      db,
      baseQuery({ queryText: 'ship email ingress cloudflare', sources: ['receipts'] }),
    );
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0].source).toBe('receipts');
    expect(result.hits[0].citations[0].transcriptEventId).toBe('receipt_search_1');
  });

  it('fails closed on unsupported sources and unsupported scope narrowings', async () => {
    await expect(
      searchTranscripts(db, baseQuery({ sources: ['diffs'] })),
    ).rejects.toThrow(UnsupportedSearchSourceError);
    await expect(
      searchTranscripts(db, baseQuery({ scope: { projectId: 'proj_1' } })),
    ).rejects.toThrow(UnsupportedScopeError);
  });

  it('rejects a query that violates the frozen contract (fail-closed both directions)', async () => {
    const bad = { ...baseQuery(), budget: {} } as unknown as TranscriptSearchQuery;
    await expect(searchTranscripts(db, bad)).rejects.toThrow(/contract violation/);
  });

  it('extractSearchText skips hash/discriminator fields and honors redaction states', () => {
    expect(
      extractSearchText({
        kind: 'assistant_message',
        payloadJson: { text: 'hello world' },
        contentHash: 'sha256:aaaa',
        prevHash: 'sha256:bbbb',
      }),
    ).toBe('assistant_message hello world');
    expect(extractSearchText({ kind: 'x', redactionState: 'redacted', payloadJson: { text: 'nope' } })).toBeNull();
    expect(extractSearchText({ kind: 'x', visibility: 'private-redacted', payloadJson: { text: 'nope' } })).toBeNull();
  });

  it('visibility ceiling filters classes above the caller', async () => {
    appendEvent(db, {
      streamType: 'transcript-event',
      payload: transcriptA('system_guidance', { text: 'operator only deploy guidance ingress' }, { visibility: 'operator' }),
    });
    const agentCeiling = await searchTranscripts(
      db,
      baseQuery({
        queryText: 'operator only deploy guidance ingress',
        issuedBy: { kind: 'agent', agentNodeId: NODE_B, sessionId: SESSION_B },
        visibilityCeiling: 'agent',
        budget: { maxResults: 50 },
      }),
    );
    for (const hit of agentCeiling.hits) {
      const row = db
        .prepare('SELECT payload_json FROM harbor_events WHERE event_id = ?')
        .get(hit.citations[0].transcriptEventId) as { payload_json: string };
      const visibility = (JSON.parse(row.payload_json) as { visibility?: string }).visibility;
      expect(['agent', 'system']).toContain(visibility);
    }
  });
});
