/**
 * Agent Harbor M6 episodic memory tests (binder ch07 Milestone 6; ADR-0097
 * phase 3, `adr-0097-phase-3-episode-extraction`).
 *
 * Gates covered here:
 *   - extraction is deterministic, idempotent, and citation-backed ("a memory
 *     without a source is a suggestion, not a fact", ch04);
 *   - every persisted episode validates against the FROZEN
 *     memory-episode.schema.json — drift from the M6 contract fails;
 *   - bi-temporal validity: supersession closes validUntil, stale facts are
 *     never served as current, and asOf answers "what did we believe on D";
 *   - the ch18 M6 gate "memory retrieval never exceeds configured budget" is
 *     an ENFORCED CAP: maxResults and maxContextTokens hold under adversarial
 *     corpus sizes, and truncation is reported as data;
 *   - lexical-only retrieval is an explicit opt-in — hybrid/semantic without
 *     an embedder throws, never silently degrades (ADR-0097 §4).
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initDatabase, closeDatabase } from '../../lib/db.js';
import type { DatabaseInstance } from '../../lib/sqlite-runtime.js';
import { appendEvent, type HarborPayload } from '../../lib/agent-harbor/event-ledger.js';
import { validateAgainstSchema } from '../../lib/agent-harbor/schema-validate.js';
import {
  ensureMemoryEpisodeSchema,
  extractEpisodesFromSession,
  persistEpisode,
  recallEpisodes,
  getEpisode,
  openFactsFor,
  deriveEpisodeId,
  estimateTokens,
  RetrievalModeError,
  MemoryValidationError,
  MEMORY_EPISODE_SCHEMA,
  SEARCH_QUERY_SCHEMA,
  type MemoryEpisode,
  type RecallQuery,
  type Embedder,
} from '../../lib/agent-harbor/memory-episodes.js';

const SESSION = 'session_m6_epmem_0001';
const AGENT = 'agent_node_m6_epmem_0001';

let seq = 0;

function appendTranscript(
  db: DatabaseInstance,
  kind: string,
  payloadJson: Record<string, unknown>,
  overrides: HarborPayload = {},
): string {
  seq += 1;
  const eventId = `evt_m6_${String(seq).padStart(4, '0')}`;
  appendEvent(db, {
    streamType: 'transcript-event',
    payload: {
      eventId,
      sessionId: SESSION,
      agentNodeId: AGENT,
      sequence: seq,
      occurredAt: `2026-07-06T10:${String(seq % 60).padStart(2, '0')}:00.000Z`,
      schemaVersion: 1,
      kind,
      redactionState: 'none',
      payloadJson,
      ...overrides,
    },
  });
  return eventId;
}

/** Deterministic stub embedder: 8-dim char-code folding, versioned model id. */
const stubEmbedder: Embedder = {
  modelId: 'stub-fold-8d/test',
  embed(texts: string[]): number[][] {
    return texts.map((t) => {
      const v = new Array(8).fill(0);
      for (let i = 0; i < t.length; i++) v[i % 8] += t.charCodeAt(i) / 1000;
      return v;
    });
  },
};

function baseQuery(overrides: Partial<RecallQuery> = {}): RecallQuery {
  return {
    schema: SEARCH_QUERY_SCHEMA,
    queryId: `tsq_test_${Math.random().toString(36).slice(2, 10)}`,
    issuedAt: '2026-07-06T12:00:00.000Z',
    issuedBy: { kind: 'operator', agentNodeId: null, sessionId: null },
    queryText: 'wrangler deploy email ingress worker',
    mode: 'lexical',
    sources: ['memory-episodes'],
    budget: { maxResults: 10, maxContextTokens: 4000 },
    ...overrides,
  };
}

function manualEpisode(overrides: Partial<MemoryEpisode> = {}): MemoryEpisode {
  return {
    schema: MEMORY_EPISODE_SCHEMA,
    episodeId: `memep_manual_${Math.random().toString(36).slice(2, 12)}`,
    tier: 'graph',
    agentNodeId: AGENT,
    sessionId: SESSION,
    runId: null,
    summary: 'manual test episode',
    validFrom: '2026-07-06T09:00:00.000Z',
    validUntil: null,
    ingestedAt: '2026-07-06T09:05:00.000Z',
    supersedes: [],
    supersededBy: null,
    extractedBy: { kind: 'longshoreman', agentNodeId: null },
    citations: [{ kind: 'transcript-event', transcriptEventId: 'evt_manual_src', sessionId: SESSION }],
    sourcePayloadState: 'present',
    importance: 5,
    ...overrides,
  };
}

describe('agent-harbor episodic memory (M6, ADR-0097 phase 3)', () => {
  let db: DatabaseInstance;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    ensureMemoryEpisodeSchema(db);
    seq = 0;
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('schema + verification (sqlite-durable-agent-state)', () => {
    it('is idempotent — ensure twice is safe', () => {
      expect(() => ensureMemoryEpisodeSchema(db)).not.toThrow();
      expect(() => ensureMemoryEpisodeSchema(db)).not.toThrow();
    });

    it('verifies the live tables and fails closed on a partial schema', () => {
      db.exec('DROP TABLE harbor_memory_episodes');
      db.exec('CREATE TABLE harbor_memory_episodes (episode_id TEXT PRIMARY KEY, summary TEXT)');
      expect(() => ensureMemoryEpisodeSchema(db)).toThrow(/verification failed: missing columns/);
    });
  });

  describe('extraction from a completed session', () => {
    function seedSession(): { fileEvt: string; packetEvt: string; failEvt: string } {
      const fileEvt = appendTranscript(db, 'file_write', {
        filesTouched: ['workers/pd-email-ingress/src/index.ts', 'workers/pd-email-ingress/wrangler.toml'],
      });
      const packetEvt = appendTranscript(db, 'compaction_packet', {
        factualClaims: [
          {
            text: 'The pd-email-ingress worker deploys via the operator OAuth wrangler login; the repo token 403s.',
            confidence: 0.95,
            citations: [{ kind: 'file', fileRef: 'workers/pd-email-ingress/wrangler.toml' }],
          },
        ],
        decisions: [{ text: 'Use OAuth wrangler for worker deploys', rationale: 'repo-scoped token 403s' }],
      });
      const failEvt = appendTranscript(db, 'shell_command', {
        command: 'npx wrangler deploy --config wrangler.repo-token.toml',
        exitCode: 1,
      });
      appendTranscript(db, 'tool_result', { toolCallId: 'tool_ok_1', exitCode: 0 }); // salience: skipped
      appendTranscript(db, 'commit_created', { sha: 'abc1234', message: 'fix: deploy via oauth wrangler' });
      appendTranscript(db, 'assistant_message', { text: 'unknown-to-extractor kind, skipped' });
      appendTranscript(db, 'session_end', { outcome: 'Email ingress worker deployed via OAuth wrangler login.' });
      return { fileEvt, packetEvt, failEvt };
    }

    it('extracts cited, schema-valid episodes with validity intervals', () => {
      const { fileEvt, packetEvt, failEvt } = seedSession();
      const result = extractEpisodesFromSession(db, {
        sessionId: SESSION,
        now: () => new Date('2026-07-06T11:00:00.000Z'),
      });

      // file-work + claim + decision + command-failure + commit + outcome = 6
      expect(result.extracted).toHaveLength(6);
      expect(result.skippedExisting).toHaveLength(0);

      for (const episode of result.extracted) {
        const check = validateAgainstSchema('memory-episode', episode);
        expect(check.skipped).toBe(false);
        expect(check.errors).toEqual([]);
        // Citation rule: never an uncited memory.
        expect(episode.citations.length).toBeGreaterThanOrEqual(1);
        // Bi-temporal: world time from the source event, system time from extraction.
        expect(episode.validUntil).toBeNull();
        expect(episode.ingestedAt).toBe('2026-07-06T11:00:00.000Z');
      }

      // The file-work episode carries graph facts and cites both event and files.
      const fileWork = result.extracted.find((e) => e.episodeId === deriveEpisodeId('file-work', fileEvt));
      expect(fileWork).toBeDefined();
      expect(fileWork!.tier).toBe('graph');
      expect(fileWork!.facts).toHaveLength(2);
      expect(fileWork!.facts![0]).toMatchObject({ subject: AGENT, predicate: 'worked-on' });
      expect(fileWork!.citations.some((c) => c.kind === 'transcript-event' && c.transcriptEventId === fileEvt)).toBe(true);
      expect(fileWork!.citations.some((c) => c.kind === 'file')).toBe(true);

      // The compaction claim keeps its own citations AND anchors to the packet event.
      const claim = result.extracted.find((e) => e.episodeId === deriveEpisodeId('compaction-claim', packetEvt, '0'));
      expect(claim).toBeDefined();
      expect(claim!.tier).toBe('recall');
      expect(claim!.citations.some((c) => c.kind === 'file')).toBe(true);
      expect(claim!.citations.some((c) => c.kind === 'transcript-event' && c.transcriptEventId === packetEvt)).toBe(true);

      // Salient failure captured; successful tool_result skipped.
      const failure = result.extracted.find((e) => e.episodeId === deriveEpisodeId('command-failure', failEvt));
      expect(failure).toBeDefined();
      expect(failure!.summary).toContain('exit 1');
      expect(result.extracted.some((e) => e.summary.includes('tool_ok_1'))).toBe(false);
    });

    it('is idempotent — re-extraction persists nothing new', () => {
      seedSession();
      const first = extractEpisodesFromSession(db, { sessionId: SESSION });
      const second = extractEpisodesFromSession(db, { sessionId: SESSION });
      expect(first.extracted.length).toBeGreaterThan(0);
      expect(second.extracted).toHaveLength(0);
      expect(second.skippedExisting.sort()).toEqual(first.extracted.map((e) => e.episodeId).sort());
    });

    it('maps a redacted source onto the ch04 distilled-source tombstone contract', () => {
      const evt = appendTranscript(
        db,
        'file_write',
        { filesTouched: ['secrets/redacted-config.ts'] },
        { redactionState: 'redacted' },
      );
      const result = extractEpisodesFromSession(db, { sessionId: SESSION });
      const episode = result.extracted.find((e) => e.episodeId === deriveEpisodeId('file-work', evt));
      expect(episode).toBeDefined();
      expect(episode!.sourcePayloadState).toBe('redacted');
      expect(episode!.sourceTombstone?.originalEventHash).toMatch(/^sha256:/);
      expect(validateAgainstSchema('memory-episode', episode).errors).toEqual([]);
    });
  });

  describe('graph facts, validity intervals, and supersession (ADR-0097 §3)', () => {
    it('closes validUntil on contradiction of a single-valued predicate', () => {
      const prior = manualEpisode({
        episodeId: 'memep_prior_deploy_token',
        summary: 'Worker deploys via repo API token',
        validFrom: '2026-07-01T00:00:00.000Z',
        facts: [{ subject: 'workers/pd-email-ingress', predicate: 'deployed-via', object: 'repo-api-token' }],
      });
      expect(persistEpisode(db, prior).inserted).toBe(true);

      const successor = manualEpisode({
        episodeId: 'memep_new_deploy_oauth',
        summary: 'Worker deploys via OAuth wrangler login',
        validFrom: '2026-07-06T00:00:00.000Z',
        facts: [{ subject: 'workers/pd-email-ingress', predicate: 'deployed-via', object: 'wrangler-oauth-login' }],
      });
      const result = persistEpisode(db, successor);
      expect(result.superseded).toEqual(['memep_prior_deploy_token']);
      expect(successor.supersedes).toContain('memep_prior_deploy_token');

      const closed = getEpisode(db, 'memep_prior_deploy_token');
      expect(closed!.validUntil).toBe('2026-07-06T00:00:00.000Z');
      expect(closed!.supersededBy).toBe('memep_new_deploy_oauth');
      // The closed episode still validates: validUntil is required-but-nullable.
      expect(validateAgainstSchema('memory-episode', closed).errors).toEqual([]);

      // Current facts show only the successor.
      const open = openFactsFor(db, 'workers/pd-email-ingress');
      expect(open).toHaveLength(1);
      expect(open[0].object).toBe('wrangler-oauth-login');

      // Bi-temporal audit: before the contradiction, the old fact held.
      const believedThen = openFactsFor(db, 'workers/pd-email-ingress', '2026-07-03T00:00:00.000Z');
      expect(believedThen).toHaveLength(1);
      expect(believedThen[0].object).toBe('repo-api-token');
    });

    it('multi-valued predicates accumulate — worked-on B never un-happens worked-on A', () => {
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_work_a',
        facts: [{ subject: AGENT, predicate: 'worked-on', object: 'lib/a.ts' }],
      }));
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_work_b',
        validFrom: '2026-07-06T10:00:00.000Z',
        facts: [{ subject: AGENT, predicate: 'worked-on', object: 'lib/b.ts' }],
      }));
      const open = openFactsFor(db, AGENT);
      expect(open.map((f) => f.object).sort()).toEqual(['lib/a.ts', 'lib/b.ts']);
      expect(getEpisode(db, 'memep_work_a')!.validUntil).toBeNull();
    });

    it('rejects an episode that fails the frozen schema or citation cross-fields', () => {
      const noCitations = manualEpisode({ citations: [] as never });
      expect(() => persistEpisode(db, noCitations)).toThrow(/contract violation/);

      const badCrossField = manualEpisode({
        citations: [{ kind: 'transcript-event' }] as never,
      });
      expect(() => persistEpisode(db, badCrossField)).toThrow(/requires non-empty transcriptEventId/);
    });
  });

  describe('task-conditioned recall (ch18 M6 gate: budget never exceeded)', () => {
    function seedRecallCorpus(count = 12): void {
      for (let i = 0; i < count; i++) {
        persistEpisode(db, manualEpisode({
          episodeId: `memep_corpus_${String(i).padStart(3, '0')}`,
          tier: 'recall',
          summary: i % 2 === 0
            ? `Deploy note ${i}: the email ingress worker ships with npx wrangler deploy under the OAuth login and the routing rule stays manual.`
            : `Unrelated note ${i}: adjusted the roadmap board columns and renamed a milestone label for the console lane.`,
          validFrom: `2026-07-0${(i % 5) + 1}T08:00:00.000Z`,
          importance: 5 + (i % 3),
        }));
      }
    }

    it('returns cited, schema-valid results for a task query', () => {
      seedRecallCorpus();
      const result = recallEpisodes(db, baseQuery(), { now: () => new Date('2026-07-06T12:00:00.000Z') });

      const check = validateAgainstSchema('transcript-search-result', result);
      expect(check.skipped).toBe(false);
      expect(check.errors).toEqual([]);

      expect(result.hits.length).toBeGreaterThan(0);
      for (const hit of result.hits) {
        expect(hit.source).toBe('memory-episodes');
        expect(hit.citations.length).toBeGreaterThanOrEqual(1); // never a bare answer
      }
      // Task conditioning: deploy-related episodes outrank the roadmap noise.
      const top = getEpisode(db, result.hits[0].episodeId as string);
      expect(top!.summary).toContain('wrangler deploy');
    });

    it('enforces maxResults as a hard cap and reports truncation as data', () => {
      seedRecallCorpus();
      const result = recallEpisodes(db, baseQuery({ budget: { maxResults: 2, maxContextTokens: 4000 } }));
      expect(result.hits).toHaveLength(2);
      expect(result.budget.used.results).toBe(2);
      expect(result.budget.truncated).toBe(true);
    });

    it('NEVER exceeds maxContextTokens — the cap holds across adversarial budgets', () => {
      seedRecallCorpus(20);
      for (const maxContextTokens of [1, 8, 25, 60, 200, 4000]) {
        const result = recallEpisodes(db, baseQuery({ budget: { maxResults: 20, maxContextTokens } }));
        expect(result.budget.used.contextTokensEstimate).toBeLessThanOrEqual(maxContextTokens);
        // Sanity: the echo matches the actual snippet weight returned.
        const actual = result.hits.reduce((s, h) => s + (h.snippet ? estimateTokens(h.snippet) : 0), 0);
        expect(actual).toBe(result.budget.used.contextTokensEstimate);
        // Hits over budget keep citations (the truth) with snippet: null.
        for (const hit of result.hits) {
          if (hit.snippet === null) expect(hit.citations.length).toBeGreaterThanOrEqual(1);
        }
      }
    });

    it('marks truncated when token budget forces snippet omission', () => {
      seedRecallCorpus(10);
      const result = recallEpisodes(db, baseQuery({ budget: { maxResults: 10, maxContextTokens: 20 } }));
      expect(result.budget.truncated).toBe(true);
      expect(result.hits.some((h) => h.snippet === null)).toBe(true);
    });

    it('throws on hybrid/semantic without an embedder — lexical is never a silent fallback', () => {
      seedRecallCorpus(2);
      expect(() => recallEpisodes(db, baseQuery({ mode: 'hybrid' }))).toThrow(RetrievalModeError);
      expect(() => recallEpisodes(db, baseQuery({ mode: 'semantic' }))).toThrow(/never a silent fallback/);
    });

    it('runs hybrid with an injected embedder and echoes the engine for drift audits', () => {
      seedRecallCorpus();
      const result = recallEpisodes(db, baseQuery({ mode: 'hybrid' }), { embedder: stubEmbedder });
      expect(result.engine.mode).toBe('hybrid');
      expect(result.engine.embeddingModel).toBe('stub-fold-8d/test');
      expect(result.engine.fusion).toBe('rrf');
      expect(validateAgainstSchema('transcript-search-result', result).errors).toEqual([]);
    });

    it('never serves superseded or expired episodes as current facts', () => {
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_stale_token',
        summary: 'Deploy via repo api token wrangler deploy email ingress',
        validFrom: '2026-07-01T00:00:00.000Z',
        facts: [{ subject: 'w', predicate: 'deployed-via', object: 'repo-api-token' }],
      }));
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_fresh_oauth',
        summary: 'Deploy via oauth wrangler deploy email ingress',
        validFrom: '2026-07-06T00:00:00.000Z',
        facts: [{ subject: 'w', predicate: 'deployed-via', object: 'oauth' }],
      }));
      const current = recallEpisodes(db, baseQuery());
      const ids = current.hits.map((h) => h.episodeId);
      expect(ids).toContain('memep_fresh_oauth');
      expect(ids).not.toContain('memep_stale_token');

      // Bi-temporal recall, validity axis: as of July 3rd the superseded fact HELD.
      const then = recallEpisodes(db, baseQuery(), { asOf: '2026-07-03T00:00:00.000Z' });
      expect(then.hits.map((h) => h.episodeId)).toContain('memep_stale_token');
      expect(then.hits.map((h) => h.episodeId)).not.toContain('memep_fresh_oauth');

      // System-time axis: on July 2nd the system had not yet LEARNED either
      // fact (ingestedAt is July 6) — "what did we believe on D" is empty.
      const believed = recallEpisodes(db, baseQuery(), {
        asOf: '2026-07-03T00:00:00.000Z',
        believedAt: '2026-07-02T00:00:00.000Z',
      });
      expect(believed.hits).toHaveLength(0);
    });

    it('respects session/agent scope narrowing', () => {
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_in_scope',
        summary: 'wrangler deploy email ingress note in scope',
        sessionId: SESSION,
      }));
      persistEpisode(db, manualEpisode({
        episodeId: 'memep_out_of_scope',
        summary: 'wrangler deploy email ingress note in another session',
        sessionId: 'session_other',
      }));
      const result = recallEpisodes(db, baseQuery({ scope: { sessionIds: [SESSION] } }));
      const ids = result.hits.map((h) => h.episodeId);
      expect(ids).toContain('memep_in_scope');
      expect(ids).not.toContain('memep_out_of_scope');
    });

    it('fails closed on a query that violates the frozen contract or wrong source', () => {
      const missingBudget = baseQuery() as Record<string, unknown>;
      delete missingBudget.budget;
      expect(() => recallEpisodes(db, missingBudget as unknown as RecallQuery)).toThrow(/contract violation/);

      expect(() => recallEpisodes(db, baseQuery({ sources: ['transcript-events'] }))).toThrow(MemoryValidationError);
    });

    it('labels projection staleness honestly (C-routes convention)', () => {
      appendTranscript(db, 'file_write', { filesTouched: ['lib/x.ts'] });
      extractEpisodesFromSession(db, { sessionId: SESSION });
      const fresh = recallEpisodes(db, baseQuery());
      expect(fresh.projection.stale).toBe(false);

      appendTranscript(db, 'file_write', { filesTouched: ['lib/y.ts'] });
      const stale = recallEpisodes(db, baseQuery());
      expect(stale.projection.stale).toBe(true);
      expect(stale.projection.headSeq).toBeGreaterThan(stale.projection.lastLedgerSeq as number);
    });
  });
});
