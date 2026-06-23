/**
 * HTTP tests for the RCP-7a / RCP-12 pheromone routes (routes/pheromone.ts),
 * exercised with a REAL pheromone manager + in-memory SQLite via Fastify inject().
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { pheromonePlugin } from '../../routes/pheromone.js';
import { createPheromoneManager } from '../../lib/pheromone.js';
import { createTestDb } from '../setup-unit.js';

let db;
let app;

beforeEach(async () => {
  db = createTestDb();
  const now = Date.now();
  for (const [id, port] of [['svc-a', 6001], ['svc-b', 6002]]) {
    db.prepare(`INSERT INTO services (id, port, status, created_at, last_seen) VALUES (?, ?, 'assigned', ?, ?)`).run(id, port, now, now);
  }
  app = Fastify();
  await app.register(pheromonePlugin, { deps: { pheromones: createPheromoneManager(db), sessions: null, db } });
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  if (db) db.close();
});

describe('POST /pheromone/resolve + effective read (RCP-7a)', () => {
  test('a resolution trace damps the effective read but not the raw read', async () => {
    await app.inject({ method: 'POST', url: '/pheromone/spray', payload: { table: 'services', id: 'svc-a', key: 'heat', strength: 0.9 } });

    const res = await app.inject({ method: 'POST', url: '/pheromone/resolve', payload: { table: 'services', id: 'svc-a', key: 'heat', strength: 1 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolutions.heat).toBe(1);

    const raw = await app.inject({ method: 'GET', url: '/pheromone/services/svc-a' });
    expect(raw.json().pheromones.heat).toBeCloseTo(0.9);

    const eff = await app.inject({ method: 'GET', url: '/pheromone/services/svc-a?effective=1' });
    expect(eff.json().effective).toBe(true);
    expect(eff.json().pheromones.heat).toBeUndefined(); // damped away
  });

  test('rejects an out-of-range strength', async () => {
    const res = await app.inject({ method: 'POST', url: '/pheromone/resolve', payload: { table: 'services', id: 'svc-a', key: 'heat', strength: 9 } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /pheromone/coverage/:table (RCP-12)', () => {
  test('reports seen/unseen across the table', async () => {
    await app.inject({ method: 'POST', url: '/pheromone/spray', payload: { table: 'services', id: 'svc-a', key: 'heat', strength: 0.5 } });
    const res = await app.inject({ method: 'GET', url: '/pheromone/coverage/services' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.seen).toBe(1);
    expect(body.unseen).toEqual(['svc-b']);
  });

  test('rejects an invalid table', async () => {
    const res = await app.inject({ method: 'GET', url: '/pheromone/coverage/not_a_table' });
    expect(res.statusCode).toBe(400);
  });
});
