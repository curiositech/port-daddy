/**
 * Smoke test for routes/metrics-prom.ts
 *
 * Spins up a minimal Fastify with just the metrics-prom plugin + an in-memory
 * counters module so we can verify the endpoints end-to-end without booting
 * the whole daemon.
 */

import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createMetricsRegistry } from '../../lib/metrics-registry.js';
import { createCounters } from '../../lib/counters.js';
import { metricsPromPlugin } from '../../routes/metrics-prom.js';

describe('metrics-prom routes', () => {
  let app, registry, db, counters;

  beforeEach(async () => {
    db = createTestDb();
    counters = createCounters(db);
    registry = createMetricsRegistry();
    app = Fastify();
    await app.register(metricsPromPlugin, {
      deps: { metricsRegistry: registry, db, repoRoot: process.cwd() },
    });
    await app.ready();

    // Seed some data so the endpoints have something to render
    registry.observeHttpRequest({ method: 'GET', route: '/x', rawPath: '/x?a=1', statusCode: 200, durationMs: 5 });
    registry.observeHttpRequest({ method: 'GET', route: '/x', rawPath: '/x?a=2', statusCode: 200, durationMs: 8 });
    registry.observeHttpRequest({ method: 'POST', route: '/slow', rawPath: '/slow', statusCode: 500, durationMs: 1200 });
  });

  afterEach(async () => {
    await app.close();
    counters.shutdown();
    db.close();
  });

  describe('GET /metrics/prom', () => {
    it('returns Prometheus text/plain', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics/prom' });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/plain/);
      expect(r.payload).toMatch(/port_daddy_http_requests_total/);
      expect(r.payload).toMatch(/port_daddy_http_request_duration_ms_bucket/);
      expect(r.payload).toMatch(/route="\/x"/);
      expect(r.payload).toMatch(/route="\/slow"/);
    });
  });

  describe('GET /metrics/http/routes', () => {
    it('returns a JSON snapshot with route stats', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics/http/routes' });
      expect(r.statusCode).toBe(200);
      const j = JSON.parse(r.payload);
      expect(Array.isArray(j.routes)).toBe(true);
      expect(j.routes.length).toBeGreaterThan(0);
      expect(j.process).toBeDefined();
      expect(typeof j.process.eventLoopLagMs).toBe('number');
    });
  });

  describe('GET /metrics/http/outliers', () => {
    it('returns slow requests', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics/http/outliers?limit=10' });
      expect(r.statusCode).toBe(200);
      const j = JSON.parse(r.payload);
      expect(Array.isArray(j.outliers)).toBe(true);
      expect(j.outliers.length).toBe(1);
      expect(j.outliers[0].route).toBe('/slow');
      expect(j.outliers[0].durationMs).toBe(1200);
    });

    it('treats malformed limit values as the default rather than NaN', async () => {
      // ?limit=foo (NaN), ?limit=-1 (negative), and ?limit=99999 (over cap)
      // should all produce a sensible response, not crash or return the
      // entire ring.
      for (const bad of ['foo', '-1', '99999', '']) {
        const r = await app.inject({ method: 'GET', url: '/metrics/http/outliers?limit=' + bad });
        expect(r.statusCode).toBe(200);
        const j = JSON.parse(r.payload);
        expect(Array.isArray(j.outliers)).toBe(true);
      }
    });
  });

  describe('GET /metrics/annotations', () => {
    it('returns an events array even with no git/notes data', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics/annotations?since=3600&limit=10' });
      expect(r.statusCode).toBe(200);
      const j = JSON.parse(r.payload);
      expect(Array.isArray(j.events)).toBe(true);
      expect(typeof j.count).toBe('number');
    });

    it('includes session purposes (telos) when sessions exist', async () => {
      const now = Date.now();
      // Insert a session row directly — the schema is shared with the real db
      db.prepare(`
        INSERT INTO sessions (id, purpose, status, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?)
      `).run('test-sess-1', 'Test purpose for telos annotation', now, now);

      const r = await app.inject({ method: 'GET', url: '/metrics/annotations?since=3600&limit=50' });
      const j = JSON.parse(r.payload);
      const purposeEvent = j.events.find(e => e.kind === 'session_purpose');
      expect(purposeEvent).toBeTruthy();
      expect(purposeEvent.title).toBe('Test purpose for telos annotation');
    });
  });

  describe('GET /metrics/http/now', () => {
    it('returns a top-of-page summary', async () => {
      const r = await app.inject({ method: 'GET', url: '/metrics/http/now' });
      expect(r.statusCode).toBe(200);
      const j = JSON.parse(r.payload);
      expect(j.total_requests).toBe(3);
      expect(Array.isArray(j.hot_routes)).toBe(true);
      expect(j.hot_routes.length).toBeGreaterThan(0);
    });
  });
});
