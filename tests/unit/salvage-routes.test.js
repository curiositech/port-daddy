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
