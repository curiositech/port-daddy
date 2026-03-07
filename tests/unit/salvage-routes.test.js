/**
 * Unit Tests for Salvage Route Aliasing (Phase 10b)
 *
 * Tests that /salvage routes are the primary routes and
 * /resurrection routes still work as backward-compatible aliases.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import express from 'express';
import { createResurrectionRoutes } from '../../routes/resurrection.js';

// Build a minimal mock for the route dependencies
function createMockDeps() {
  return {
    logger: {
      info: () => {},
      error: () => {},
    },
    metrics: { errors: 0 },
    resurrection: {
      pending: (opts = {}) => ({
        success: true,
        agents: [],
        count: 0,
        filtered: !!opts.project,
      }),
      list: (opts = {}) => ({
        success: true,
        agents: [],
        count: 0,
        filtered: !!opts.project,
      }),
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

// Helper to make requests against the router
function createApp(deps) {
  const app = express();
  app.use(express.json());
  app.use(createResurrectionRoutes(deps));
  return app;
}

// Simple supertest-like request helper (no supertest dependency)
async function request(app, method, path) {
  return new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const opts = { method: method.toUpperCase() };
        if (method === 'post') {
          opts.headers = { 'Content-Type': 'application/json' };
          opts.body = JSON.stringify({ newAgentId: 'test-new' });
        }
        const res = await fetch(`http://localhost:${port}${path}`, opts);
        const body = await res.json();
        resolve({ status: res.status, body });
      } finally {
        server.close();
      }
    });
  });
}

describe('Salvage Route Aliasing', () => {
  let deps;
  let app;

  beforeEach(() => {
    deps = createMockDeps();
    app = createApp(deps);
  });

  describe('Primary /salvage routes', () => {
    it('GET /salvage should list queue entries', async () => {
      const { status, body } = await request(app, 'get', '/salvage');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.agents).toEqual([]);
    });

    it('GET /salvage/pending should list pending entries', async () => {
      const { status, body } = await request(app, 'get', '/salvage/pending');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('POST /salvage/claim/:agentId should claim an agent', async () => {
      const { status, body } = await request(app, 'post', '/salvage/claim/dead-agent');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('Backward-compatible /resurrection aliases', () => {
    it('GET /resurrection should work as alias', async () => {
      const { status, body } = await request(app, 'get', '/resurrection');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('GET /resurrection/pending should work as alias', async () => {
      const { status, body } = await request(app, 'get', '/resurrection/pending');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('POST /resurrection/claim/:agentId should work as alias', async () => {
      const { status, body } = await request(app, 'post', '/resurrection/claim/dead-agent');
      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });
  });

  describe('Both routes return identical responses', () => {
    it('GET /salvage and GET /resurrection should return same structure', async () => {
      const salvage = await request(app, 'get', '/salvage');
      const resurrection = await request(app, 'get', '/resurrection');

      expect(salvage.body.success).toBe(resurrection.body.success);
      expect(salvage.body.count).toBe(resurrection.body.count);
    });

    it('GET /salvage/pending and GET /resurrection/pending should return same structure', async () => {
      const salvage = await request(app, 'get', '/salvage/pending');
      const resurrection = await request(app, 'get', '/resurrection/pending');

      expect(salvage.body.success).toBe(resurrection.body.success);
      expect(salvage.body.count).toBe(resurrection.body.count);
    });
  });
});
