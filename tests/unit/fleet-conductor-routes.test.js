/**
 * Tests for the Conductor operator-control routes in routes/fleet.ts (ADR-0060):
 *   POST /fleet/halt | /fleet/pause | /fleet/resume
 *   GET  /fleet/tree/:rootId
 *
 * These prove the operator control SURFACE is wired to the in-process conductor
 * methods (PM gap #1): an operator can halt/pause/resume/inspect the live fleet
 * over HTTP. The routes self-degrade to 503 when no conductor is wired.
 *
 * We drive a REAL conductor (not a mock) over a fake spawner so the route → core
 * path is exercised end-to-end.
 */

import { jest } from '@jest/globals';
import Fastify from 'fastify';
import Database from 'better-sqlite3';

import { fleetPlugin } from '../../routes/fleet.js';
import { createConductor } from '../../lib/fleet/conductor.js';

function makeSpawner() {
  let counter = 0;
  const cancelled = [];
  return {
    cancelled,
    spawn: jest.fn(async () => ({
      agentId: `agent-${++counter}`,
      status: 'completed',
      output: 'ok',
      error: null,
    })),
    cancel: jest.fn((id) => cancelled.push(id)),
  };
}

/** Minimal fleetDaemon/projects/messaging stubs the plugin also needs. */
function baseDeps(conductor) {
  return {
    fleetDaemon: {
      getStatus: () => ({ running: true, startedAt: Date.now(), fleets: [], totalAgents: 0, totalWatchers: 0 }),
    },
    projects: { get: () => null, getByPath: () => null },
    messaging: { subscribe: () => null, publish: () => {} },
    conductor,
  };
}

async function makeApp(conductor) {
  const app = Fastify();
  await app.register(fleetPlugin, { deps: baseDeps(conductor) });
  return app;
}

describe('Conductor operator-control routes (ADR-0060)', () => {
  test('GET /fleet folds Cloudflare telemetry agents into aggregate reporting', async () => {
    const remoteAgent = {
      id: 'cloudflare:curiositech.port-daddy:code-reviewer:abc12345',
      type: 'cloudflare',
      pid: 0,
      isActive: true,
      lastHeartbeat: Date.now(),
    };
    const cloudAppTelemetry = {
      agents: jest.fn(() => [remoteAgent]),
    };
    const app = Fastify();
    await app.register(fleetPlugin, {
      deps: {
        ...baseDeps(undefined),
        cloudAppTelemetry,
      },
    });

    const res = await app.inject({ method: 'GET', url: '/fleet' });
    const body = res.json();

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.totalAgents).toBe(1);
    expect(body.localTotalAgents).toBe(0);
    expect(body.remoteAgentCount).toBe(1);
    expect(body.remoteActiveAgentCount).toBe(1);
    expect(body.remote.cloudApp.agents).toEqual([remoteAgent]);
    expect(cloudAppTelemetry.agents).toHaveBeenCalledWith({
      since: expect.any(Number),
      limit: 500,
    });

    await app.close();
  });

  test('POST /fleet/halt (global) halts running launches and reports the count', async () => {
    // A pending spawner keeps the launch RUNNING so the halt has a live target.
    let resolveSpawn;
    const pendingSpawner = {
      cancelled: [],
      spawn: jest.fn(() => new Promise((r) => { resolveSpawn = () => r({ agentId: 'agent-x', status: 'completed', output: 'ok', error: null }); })),
      cancel: jest.fn((id) => pendingSpawner.cancelled.push(id)),
    };
    const db = new Database(':memory:');
    const conductor = createConductor({ db, spawner: pendingSpawner, isMainCheckout: () => false });
    const app = await makeApp(conductor);

    const p = conductor.launch({ goal: 'g', backend: 'claude', source: 'operator', worktree: 'inherit', lineageCeilingUsd: 100 });
    await new Promise((r) => setTimeout(r, 0)); // reach running

    const res = await app.inject({ method: 'POST', url: '/fleet/halt', payload: {} });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.scope).toBe('global');
    expect(body.count).toBe(1);

    resolveSpawn?.();
    await p.catch(() => {});
    await app.close();
  });

  test('POST /fleet/pause then /fleet/resume freezes then reopens admission', async () => {
    const db = new Database(':memory:');
    const conductor = createConductor({ db, spawner: makeSpawner(), isMainCheckout: () => false });
    const app = await makeApp(conductor);

    const pauseRes = await app.inject({ method: 'POST', url: '/fleet/pause', payload: {} });
    expect(pauseRes.json().paused).toBe(true);
    // Admission is frozen → a new operator launch is refused.
    const blocked = await conductor.launch({ goal: 'g', backend: 'claude', source: 'operator', worktree: 'inherit', lineageCeilingUsd: 100 });
    expect(blocked.admitted).toBe(false);

    const resumeRes = await app.inject({ method: 'POST', url: '/fleet/resume', payload: {} });
    expect(resumeRes.json().resumed).toBe(true);
    const ok = await conductor.launch({ goal: 'g2', backend: 'claude', source: 'operator', worktree: 'inherit', lineageCeilingUsd: 100 });
    expect(ok.admitted).toBe(true);

    await app.close();
  });

  test('GET /fleet/tree/:rootId renders the lineage tree for a root', async () => {
    const db = new Database(':memory:');
    const conductor = createConductor({ db, spawner: makeSpawner(), isMainCheckout: () => false });
    const app = await makeApp(conductor);

    // mergePolicy 'review' leaves the root in `produced` (non-terminal) so a
    // child can name it as a live parent.
    const root = await conductor.launch({ goal: 'root', backend: 'claude', source: 'operator', worktree: 'inherit', mergePolicy: 'review', lineageCeilingUsd: 100 });
    const child = await conductor.launch({ goal: 'child', backend: 'claude', source: 'agent', parentId: root.launch.id, mergePolicy: 'review' });
    expect(child.admitted).toBe(true);

    const res = await app.inject({ method: 'GET', url: `/fleet/tree/${root.launch.rootId}` });
    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.tree.map((n) => n.goal)).toEqual(expect.arrayContaining(['root', 'child']));

    await app.close();
  });

  test('control routes return 503 when no conductor is wired (legacy/test setup)', async () => {
    const app = Fastify();
    await app.register(fleetPlugin, { deps: { ...baseDeps(undefined), conductor: undefined } });
    for (const url of ['/fleet/halt', '/fleet/pause', '/fleet/resume']) {
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toMatch(/Conductor not wired/);
    }
    const tree = await app.inject({ method: 'GET', url: '/fleet/tree/whatever' });
    expect(tree.statusCode).toBe(503);
    await app.close();
  });
});
