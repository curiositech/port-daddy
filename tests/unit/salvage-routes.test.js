/**
 * Unit Tests for Salvage Route Aliasing (Phase 10b)
 *
 * Tests that /salvage routes are the primary routes and
 * /resurrection routes still work as backward-compatible aliases.
 *
 * Uses Fastify inject() — no real HTTP server needed.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { resurrectionPlugin } from '../../routes/resurrection.js';
import { createTestDb } from '../setup-unit.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';

// Build a minimal mock for the route dependencies
function createMockDeps() {
  return {
    logger: {
      info: () => {},
      error: () => {},
    },
    metrics: { errors: 0 },
    resurrection: {
      pending: jest.fn((opts = {}) => ({
        success: true,
        agents: [],
        count: 0,
        filtered: !!opts.project,
      })),
      list: jest.fn((opts = {}) => ({
        success: true,
        agents: [],
        count: 0,
        filtered: !!opts.project,
      })),
      claim: (agentId) => ({
        success: true,
        agent: { id: agentId, name: agentId, status: 'dead' },
        context: {},
      }),
      complete: (oldId, newId) => ({ success: true }),
      abandon: (agentId) => ({ success: true }),
      dismiss: (agentId) => ({ success: true }),
      countByProject: () => 0,
    },
    messaging: {
      publish: () => ({ success: true }),
    },
    activityLog: {
      log: () => {},
    },
  };
}

function readyContextLookup(sourceSessionId) {
  const packet = {
    schema: 'pd.agent-harbor.compaction-packet.v0',
    packetId: 'cpk_salvage_fixture',
    agentNodeId: 'agent_salvage_fixture',
    sessionId: sourceSessionId,
    createdAt: '2026-08-27T00:00:00.000Z',
    createdBy: { kind: 'daemon' },
    trigger: { kind: 'context-threshold', contextEnvelopeRef: 'ctx_salvage_fixture' },
    identity: { task: 'Use only the verified salvage plan' },
    obligations: [],
    factualClaims: [],
    transcriptExcerpts: [{ citation: { kind: 'transcript-event', transcriptEventId: 'evt_raw' }, excerpt: 'SALVAGE_RAW_TRANSCRIPT_MUST_NOT_ESCAPE' }],
    nextAction: { recommendation: 'Read the cited checkpoint.' },
    sourceTranscript: { headEventId: 'evt_salvage_head', headHash: 'salvage_hash' },
    validator: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    transcriptEventId: 'evt_salvage_packet',
  };
  return {
    status: 'ready',
    sourceSessionId,
    packet,
    bootstrap: {
      packet,
      sessionId: sourceSessionId,
      agentNodeId: 'agent_salvage_fixture',
      planCheckpoint: {
        transcriptEventId: 'evt_salvage_plan',
        content: '- [ ] Resume the bounded salvage plan',
        capturedAt: '2026-08-27T00:00:00.000Z',
      },
      transcriptPrefix: [{ transcriptEventId: 'evt_raw', sequence: 8, kind: 'tool_result', ledgerSeq: 10 }],
      transcriptPrefixTruncated: true,
      contextRef: { kind: 'compaction-packet', ref: 'packet:cpk_salvage_fixture', droppable: false },
      revalidation: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    },
    envelope: { schema: 'pd.agent-harbor.context-envelope.v0' },
  };
}

describe('Salvage Route Aliasing', () => {
  let deps;
  let app;
  let db;
  let claimer;

  beforeEach(async () => {
    deps = createMockDeps();
    // #8877 / ADR-0122: salvage mutations require daemon-minted credentials.
    db = createTestDb();
    const souls = createTestActorSouls(db);
    claimer = mintTestActor(souls, 'test-new');
    deps.actorSouls = souls;
    app = Fastify();
    await app.register(resurrectionPlugin, { deps });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  describe('Primary /salvage routes', () => {
    it('GET /salvage should list queue entries', async () => {
      const res = await app.inject({ method: 'GET', url: '/salvage' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.agents).toEqual([]);
    });

    it('GET /salvage/pending should list pending entries', async () => {
      const res = await app.inject({ method: 'GET', url: '/salvage/pending' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it('GET /salvage/pending should pass limit and filters to the pending queue', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/salvage/pending?limit=2&project=port-daddy&stack=runtime',
      });
      expect(res.statusCode).toBe(200);
      expect(deps.resurrection.pending).toHaveBeenCalledWith({
        limit: 2,
        project: 'port-daddy',
        stack: 'runtime',
      });
    });

    it('POST /salvage/claim/:agentId should claim an agent', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/salvage/claim/dead-agent',
        payload: { newAgentId: 'test-new' },
        headers: claimer.headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it('POST /salvage/claim/:agentId attaches only a verified matching-session continuation after auth', async () => {
      const lookups = [];
      const localDeps = createMockDeps();
      const localDb = createTestDb();
      const localSouls = createTestActorSouls(localDb);
      const localClaimer = mintTestActor(localSouls, 'test-new');
      localDeps.actorSouls = localSouls;
      localDeps.resurrection.claim = jest.fn(() => ({
        success: true,
        agent: { id: 'dead-agent', name: 'dead-agent', status: 'dead', sessionId: 'session_salvage_source' },
        context: { sessionId: 'session_salvage_source', notes: ['existing salvage note'] },
      }));
      localDeps.contextBootstrapLookup = (sourceSessionId) => {
        lookups.push(sourceSessionId);
        return readyContextLookup(sourceSessionId);
      };
      const localApp = Fastify();
      await localApp.register(resurrectionPlugin, { deps: localDeps });
      await localApp.ready();

      const res = await localApp.inject({
        method: 'POST',
        url: '/salvage/claim/dead-agent',
        payload: { newAgentId: 'test-new' },
        headers: localClaimer.headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(lookups).toEqual(['session_salvage_source']);
      expect(body.contextContinuation).toEqual(expect.objectContaining({
        status: 'ready',
        sourceSessionId: 'session_salvage_source',
        packet: expect.objectContaining({ packetId: 'cpk_salvage_fixture' }),
        planCheckpoint: expect.objectContaining({ content: '- [ ] Resume the bounded salvage plan' }),
      }));
      expect(body.contextContinuation).not.toHaveProperty('transcriptPrefix');
      expect(JSON.stringify(body.contextContinuation)).not.toContain('SALVAGE_RAW_TRANSCRIPT_MUST_NOT_ESCAPE');
      await localApp.close();
      localDb.close();
    });

    it('POST /salvage/claim/:agentId with mismatched durable source ids remains none', async () => {
      const lookup = jest.fn(() => readyContextLookup('session_untrusted'));
      const localDeps = createMockDeps();
      const localDb = createTestDb();
      const localSouls = createTestActorSouls(localDb);
      const localClaimer = mintTestActor(localSouls, 'test-new');
      localDeps.actorSouls = localSouls;
      localDeps.resurrection.claim = jest.fn(() => ({
        success: true,
        agent: { id: 'dead-agent', name: 'dead-agent', status: 'dead', sessionId: 'session_agent' },
        context: { sessionId: 'session_context', notes: ['untrusted mismatch'] },
      }));
      localDeps.contextBootstrapLookup = lookup;
      const localApp = Fastify();
      await localApp.register(resurrectionPlugin, { deps: localDeps });
      await localApp.ready();

      const res = await localApp.inject({
        method: 'POST',
        url: '/salvage/claim/dead-agent',
        payload: { newAgentId: 'test-new' },
        headers: localClaimer.headers,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().contextContinuation).toEqual({ status: 'none' });
      expect(lookup).not.toHaveBeenCalled();
      await localApp.close();
      localDb.close();
    });
  });

  describe('Backward-compatible /resurrection aliases', () => {
    it('GET /resurrection should work as alias', async () => {
      const res = await app.inject({ method: 'GET', url: '/resurrection' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it('GET /resurrection/pending should work as alias', async () => {
      const res = await app.inject({ method: 'GET', url: '/resurrection/pending' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it('POST /resurrection/claim/:agentId should work as alias', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/resurrection/claim/dead-agent',
        payload: { newAgentId: 'test-new' },
        headers: claimer.headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('Both routes return identical responses', () => {
    it('GET /salvage and GET /resurrection should return same structure', async () => {
      const salvageRes = await app.inject({ method: 'GET', url: '/salvage' });
      const resurrectionRes = await app.inject({ method: 'GET', url: '/resurrection' });

      const salvage = salvageRes.json();
      const resurrection = resurrectionRes.json();

      expect(salvage.success).toBe(resurrection.success);
      expect(salvage.count).toBe(resurrection.count);
    });

    it('GET /salvage/pending and GET /resurrection/pending should return same structure', async () => {
      const salvageRes = await app.inject({ method: 'GET', url: '/salvage/pending' });
      const resurrectionRes = await app.inject({ method: 'GET', url: '/resurrection/pending' });

      const salvage = salvageRes.json();
      const resurrection = resurrectionRes.json();

      expect(salvage.success).toBe(resurrection.success);
      expect(salvage.count).toBe(resurrection.count);
    });
  });
});
