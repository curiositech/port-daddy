/**
 * Unit tests: /sitrep route
 *
 * Exercises the route via a minimal fastify instance and in-memory deps
 * — the same pattern used in briefing.test.js. Validates:
 *   1. Default 60-minute window
 *   2. Custom since_minutes override
 *   3. Summary string formatting (plural/singular agreement)
 *   4. Empty-state (nothing happened — still a valid response, not an error)
 *   5. Graceful handling of missing optional deps (no spawner)
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createAgents } from '../../lib/agents.js';
import { createActivityLog } from '../../lib/activity.js';
import { createResurrection } from '../../lib/resurrection.js';
import { sitrepPlugin } from '../../routes/sitrep.js';

const sitrepCliSource = readFileSync(resolve(import.meta.dirname, '../../cli/commands/sitrep.ts'), 'utf8');

let db;
let app;
let sessions;
let agents;
let activityLog;
let resurrection;

beforeEach(async () => {
  db = createTestDb();
  sessions = createSessions(db);
  agents = createAgents(db);
  activityLog = createActivityLog(db);
  resurrection = createResurrection(db);
  sessions.setActivityLog(activityLog);

  app = Fastify({ logger: false });
  // Mock spawner with a deterministic list() for assertions.
  const spawner = { list: () => [{ id: 'spawn-abc', identity: 'test:fleet:worker', status: 'running' }] };
  await app.register(sitrepPlugin, {
    deps: { activityLog, sessions, resurrection, spawner },
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('/sitrep', () => {
  test('CLI uses the shared relative transport resolver for every sitrep request', () => {
    expect(sitrepCliSource).not.toContain('PORT_DADDY_URL');
    expect(sitrepCliSource).toContain('pdFetch(`/sitrep${qs}`)');
    expect(sitrepCliSource).toContain('pdFetch(`/sessions/${sessionId}`)');
  });

  test('returns structure with defaults when harbor is empty', async () => {
    const res = await app.inject({ method: 'GET', url: '/sitrep' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.since_minutes).toBe(60);
    expect(typeof body.since_ms).toBe('number');
    expect(Array.isArray(body.activity)).toBe(true);
    expect(Array.isArray(body.notes)).toBe(true);
    expect(Array.isArray(body.salvage_queue)).toBe(true);
    expect(body.spawned_agents).toHaveLength(1);
    expect(body.summary).toMatch(/^Last 60m:/);
  });

  test('honors since_minutes query param', async () => {
    const res = await app.inject({ method: 'GET', url: '/sitrep?since_minutes=15' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.since_minutes).toBe(15);
    expect(body.summary).toMatch(/^Last 15m:/);
  });

  test('pluralizes agents correctly', async () => {
    // 1 spawned agent, 0 dead — singular for spawned, plural for dead
    const res = await app.inject({ method: 'GET', url: '/sitrep' });
    const body = res.json();
    expect(body.summary).toMatch(/0 dead agents/);
    expect(body.summary).toMatch(/1 spawned agent(?!s)/);
  });

  test('reflects written notes in the synthesis', async () => {
    const started = sessions.start('test', { agentId: 'agent-x' });
    const sessionId = started.session?.id || started.id;
    sessions.addNote(sessionId, 'hello from the test harness', { type: 'general' });

    const res = await app.inject({ method: 'GET', url: '/sitrep' });
    const body = res.json();
    expect(body.notes.length).toBeGreaterThanOrEqual(1);
    const contents = body.notes.map((n) => n.content || n.note);
    expect(contents.some((c) => String(c).includes('hello from the test harness'))).toBe(true);
  });

  test('clamps non-positive since_minutes to the default', async () => {
    const res = await app.inject({ method: 'GET', url: '/sitrep?since_minutes=0' });
    const body = res.json();
    expect(body.since_minutes).toBe(60);
  });

  test('rejects non-numeric since_minutes gracefully (fall back to default)', async () => {
    const res = await app.inject({ method: 'GET', url: '/sitrep?since_minutes=bogus' });
    const body = res.json();
    expect(body.since_minutes).toBe(60);
  });

  test('supports camelCase alias sinceMinutes', async () => {
    const res = await app.inject({ method: 'GET', url: '/sitrep?sinceMinutes=45' });
    const body = res.json();
    expect(body.since_minutes).toBe(45);
  });

  test('bounds every collection and strips full salvage histories from the response', async () => {
    await app.close();
    const huge = 'sensitive-payload-'.repeat(1_000);
    const many = Array.from({ length: 150 }, (_, index) => index);
    app = Fastify({ logger: false });
    await app.register(sitrepPlugin, {
      deps: {
        activityLog: {
          getRecent: () => ({ entries: many.map((index) => ({ id: index, type: 'event', details: huge, metadata: { huge } })), total: many.length }),
        },
        sessions: {
          getNotes: () => ({ notes: many.map((index) => ({ id: index, content: huge, created_at: index })) }),
        },
        resurrection: {
          pending: () => ({
            agents: many.map((index) => ({
              id: `dead-${index}`,
              purpose: huge,
              notes: Array.from({ length: 200 }, () => huge),
            })),
          }),
        },
        spawner: {
          list: () => many.map((index) => ({ id: `spawn-${index}`, identity: huge, task: huge, status: 'running' })),
        },
      },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/sitrep' });
    const body = res.json();
    expect(body.activity).toHaveLength(30);
    expect(body.notes).toHaveLength(20);
    expect(body.salvage_queue).toHaveLength(20);
    expect(body.spawned_agents).toHaveLength(20);
    expect(body.salvage_queue[0].notes).toHaveLength(3);
    expect(body.salvage_queue[0].noteWindow).toEqual({ total: 200, returned: 3, truncated: true });
    expect(body.window.activity.truncated).toBe(true);
    expect(body.window.notes.truncated).toBe(true);
    expect(body.window.salvage.truncated).toBe(true);
    expect(body.window.spawned.truncated).toBe(true);
    expect(Buffer.byteLength(res.body)).toBeLessThan(128 * 1024);

    const quiet = await app.inject({ method: 'GET', url: '/sitrep?summary_only=1' });
    const quietBody = quiet.json();
    expect(quietBody.activity).toEqual([]);
    expect(quietBody.salvage_queue).toEqual([]);
    expect(quietBody.window.summaryOnly).toBe(true);
    expect(Buffer.byteLength(quiet.body)).toBeLessThan(4 * 1024);
  });

  test('works without a spawner (optional dep)', async () => {
    // Re-register plugin WITHOUT spawner dep.
    await app.close();
    app = Fastify({ logger: false });
    await app.register(sitrepPlugin, {
      deps: { activityLog, sessions, resurrection },
    });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/sitrep' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.spawned_agents).toHaveLength(0);
  });
});
