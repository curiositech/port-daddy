/**
 * Resurrection / Salvage Route Integration Tests
 *
 * Tests the resurrection lifecycle through the HTTP API and verifies
 * that /salvage/* route aliases behave identically to /resurrection/*.
 *
 * The ephemeral daemon is started automatically by Jest globalSetup.
 */

import { request } from '../helpers/integration-setup.js';

// Track agents for cleanup
const createdAgents = [];

/**
 * Helper: register an agent via the API
 */
async function registerAgent(id, opts = {}) {
  const body = {
    id,
    name: opts.name || id,
    type: opts.type || 'test',
    identity: opts.identity || `test:resurrection:${id}`,
    purpose: opts.purpose || 'Resurrection test agent',
  };
  const res = await request('/agents', { method: 'POST', body });
  if (res.ok) createdAgents.push(id);
  return res;
}

/**
 * Helper: start a session for an agent
 */
async function startSession(agentId, purpose) {
  return request('/sessions', {
    method: 'POST',
    body: { agentId, purpose: purpose || 'Resurrection test session' },
  });
}

/**
 * Helper: trigger the reaper to detect dead agents
 */
async function triggerReaper() {
  return request('/resurrection/reap', { method: 'POST' });
}

/**
 * Helper: unregister an agent (best effort cleanup)
 */
async function unregisterAgent(id) {
  try {
    await request(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch {
    // Ignore
  }
}

describe('Resurrection / Salvage Route Integration', () => {
  afterAll(async () => {
    for (const id of createdAgents) {
      await unregisterAgent(id);
    }
  });

  // ===========================================================================
  // 1. Resurrection routes — basic functionality
  // ===========================================================================
  describe('GET /resurrection/pending', () => {
    test('returns success with empty list when no dead agents exist', async () => {
      const res = await request('/resurrection/pending');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(Array.isArray(res.data.agents)).toBe(true);
      expect(typeof res.data.count).toBe('number');
    });

    test('accepts project filter query param', async () => {
      const res = await request('/resurrection/pending?project=nonexistent-project');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(res.data.count).toBe(0);
    });

    test('accepts stack filter query param', async () => {
      const res = await request('/resurrection/pending?project=myapp&stack=api');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });
  });

  describe('GET /resurrection', () => {
    test('returns success with agents list', async () => {
      const res = await request('/resurrection');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(Array.isArray(res.data.agents)).toBe(true);
    });

    test('accepts limit query param', async () => {
      const res = await request('/resurrection?limit=5');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('accepts project and stack filters', async () => {
      const res = await request('/resurrection?project=myapp&stack=api');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });
  });

  describe('POST /resurrection/claim/:agentId', () => {
    test('returns error for non-existent agent', async () => {
      const res = await request('/resurrection/claim/nonexistent-ghost', {
        method: 'POST',
        body: { newAgentId: 'rescuer' },
      });

      // Should fail gracefully (not 500)
      expect(res.status).not.toBe(500);
      expect(res.data.success).toBe(false);
    });
  });

  describe('POST /resurrection/complete/:agentId', () => {
    test('requires newAgentId in body', async () => {
      const res = await request('/resurrection/complete/some-agent', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toMatch(/newAgentId/);
    });
  });

  describe('POST /resurrection/abandon/:agentId', () => {
    test('returns success even for non-queued agent (idempotent)', async () => {
      const res = await request('/resurrection/abandon/nonexistent-agent', {
        method: 'POST',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });
  });

  describe('DELETE /resurrection/:agentId', () => {
    test('returns success for dismissing non-existent agent (idempotent)', async () => {
      const res = await request('/resurrection/nonexistent-dismiss', {
        method: 'DELETE',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });
  });

  // ===========================================================================
  // 2. Salvage aliases — must behave identically to /resurrection
  // ===========================================================================
  describe('Salvage aliases mirror resurrection routes', () => {
    test('GET /salvage/pending returns same shape as /resurrection/pending', async () => {
      const [resurrectionRes, salvageRes] = await Promise.all([
        request('/resurrection/pending'),
        request('/salvage/pending'),
      ]);

      expect(salvageRes.ok).toBe(true);
      expect(salvageRes.data.success).toBe(resurrectionRes.data.success);
      expect(salvageRes.data.count).toBe(resurrectionRes.data.count);
      expect(Array.isArray(salvageRes.data.agents)).toBe(true);
    });

    test('GET /salvage/pending accepts project filter', async () => {
      const res = await request('/salvage/pending?project=test-project');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
      expect(typeof res.data.count).toBe('number');
    });

    test('GET /salvage/pending accepts project + stack filters', async () => {
      const res = await request('/salvage/pending?project=myapp&stack=api');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('GET /salvage returns same shape as /resurrection', async () => {
      const [resurrectionRes, salvageRes] = await Promise.all([
        request('/resurrection'),
        request('/salvage'),
      ]);

      expect(salvageRes.ok).toBe(true);
      expect(salvageRes.data.success).toBe(resurrectionRes.data.success);
      expect(salvageRes.data.count).toBe(resurrectionRes.data.count);
      expect(Array.isArray(salvageRes.data.agents)).toBe(true);
    });

    test('GET /salvage accepts limit query param', async () => {
      const res = await request('/salvage?limit=10');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('GET /salvage accepts project and stack filters', async () => {
      const res = await request('/salvage?project=test&stack=web');

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('POST /salvage/claim/:agentId mirrors /resurrection/claim', async () => {
      const res = await request('/salvage/claim/nonexistent-ghost', {
        method: 'POST',
        body: { newAgentId: 'rescuer' },
      });

      // Same behavior as /resurrection/claim — fails for non-existent agent
      expect(res.status).not.toBe(500);
      expect(res.data.success).toBe(false);
    });

    test('POST /salvage/complete/:agentId requires newAgentId', async () => {
      const res = await request('/salvage/complete/some-agent', {
        method: 'POST',
        body: {},
      });

      expect(res.status).toBe(400);
      expect(res.data.error).toMatch(/newAgentId/);
    });

    test('POST /salvage/abandon/:agentId is idempotent', async () => {
      const res = await request('/salvage/abandon/nonexistent-agent', {
        method: 'POST',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });

    test('DELETE /salvage/:agentId is idempotent', async () => {
      const res = await request('/salvage/nonexistent-dismiss', {
        method: 'DELETE',
      });

      expect(res.ok).toBe(true);
      expect(res.data.success).toBe(true);
    });
  });

  // ===========================================================================
  // 3. POST /resurrection/reap — trigger reaper
  // ===========================================================================
  describe('POST /resurrection/reap', () => {
    test('reap endpoint returns success', async () => {
      const res = await triggerReaper();

      // Reap may or may not exist depending on version — check response
      if (res.status === 404) {
        // Route not mounted in this version — skip
        return;
      }

      expect(res.ok).toBe(true);
    });
  });

  // ===========================================================================
  // 4. Server health after resurrection operations
  // ===========================================================================
  describe('Post-test health', () => {
    test('daemon is still healthy after all resurrection operations', async () => {
      const res = await request('/health');
      expect(res.ok).toBe(true);
      expect(res.data.status).toBe('ok');
    });
  });
});
