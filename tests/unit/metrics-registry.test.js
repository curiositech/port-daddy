/**
 * Unit tests for lib/metrics-registry.ts
 *
 * Covers:
 *  - HTTP request observation (count, sum, bucket placement)
 *  - p50/p95/p99 from ring buffer
 *  - Outlier capture + skip-list for SSE routes
 *  - Status class bucketing
 *  - Prometheus text exposition format
 *  - Generic counter incrementing
 */

import { createMetricsRegistry } from '../../lib/metrics-registry.js';

describe('MetricsRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = createMetricsRegistry();
  });

  // ── observation ──────────────────────────────────────────────────────────
  describe('observeHttpRequest', () => {
    it('counts requests per method/route/status', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/health', rawPath: '/health', statusCode: 200, durationMs: 5 });
      registry.observeHttpRequest({ method: 'GET', route: '/health', rawPath: '/health', statusCode: 200, durationMs: 7 });
      registry.observeHttpRequest({ method: 'GET', route: '/health', rawPath: '/health', statusCode: 500, durationMs: 12 });

      const snap = registry.snapshot();
      const ok = snap.routes.find(r => r.route === '/health' && r.status === '2xx');
      const err = snap.routes.find(r => r.route === '/health' && r.status === '5xx');
      expect(ok.count).toBe(2);
      expect(err.count).toBe(1);
    });

    it('buckets status codes into 2xx/3xx/4xx/5xx classes', () => {
      const cases = [
        { code: 200, expected: '2xx' },
        { code: 204, expected: '2xx' },
        { code: 301, expected: '3xx' },
        { code: 400, expected: '4xx' },
        { code: 404, expected: '4xx' },
        { code: 500, expected: '5xx' },
        { code: 503, expected: '5xx' },
      ];
      for (const c of cases) {
        registry.observeHttpRequest({ method: 'GET', route: '/x', rawPath: '/x', statusCode: c.code, durationMs: 1 });
      }
      const snap = registry.snapshot();
      for (const c of cases) {
        const series = snap.routes.find(r => r.route === '/x' && r.status === c.expected);
        expect(series).toBeTruthy();
      }
    });

    it('places observations into the correct histogram bucket', () => {
      // 1ms -> "1" bucket; 50ms -> "50"; 1500ms -> "2500"; 100s -> "+Inf"
      const samples = [0.5, 50, 1500, 100_000];
      for (const ms of samples) {
        registry.observeHttpRequest({ method: 'GET', route: '/b', rawPath: '/b', statusCode: 200, durationMs: ms });
      }
      const snap = registry.snapshot();
      const series = snap.routes.find(r => r.route === '/b');
      expect(series.count).toBe(4);

      // Each sample should fall into exactly one non-cumulative bucket
      const counts = Object.fromEntries(series.buckets.map(b => [b.le, b.count]));
      expect(counts['1']).toBe(1);       // 0.5ms
      expect(counts['50']).toBe(1);      // exactly 50ms
      expect(counts['2500']).toBe(1);    // 1500ms
      expect(counts['+Inf']).toBe(1);    // 100000ms
    });
  });

  // ── percentiles ──────────────────────────────────────────────────────────
  describe('percentiles', () => {
    it('reports p50 / p95 / p99 from ring buffer', () => {
      // 100 evenly distributed samples 1..100ms
      for (let i = 1; i <= 100; i++) {
        registry.observeHttpRequest({ method: 'GET', route: '/p', rawPath: '/p', statusCode: 200, durationMs: i });
      }
      const series = registry.snapshot().routes.find(r => r.route === '/p');
      expect(series.p50).toBeGreaterThanOrEqual(50);
      expect(series.p50).toBeLessThanOrEqual(52);
      expect(series.p95).toBeGreaterThanOrEqual(95);
      expect(series.p95).toBeLessThanOrEqual(97);
      expect(series.p99).toBeGreaterThanOrEqual(99);
      expect(series.maxMs).toBe(100);
    });

    it('handles a single observation without crashing', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/one', rawPath: '/one', statusCode: 200, durationMs: 42 });
      const series = registry.snapshot().routes.find(r => r.route === '/one');
      expect(series.count).toBe(1);
      expect(series.p50).toBe(42);
    });
  });

  // ── outliers ─────────────────────────────────────────────────────────────
  describe('outliers', () => {
    it('captures requests above 500ms', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/fast', rawPath: '/fast', statusCode: 200, durationMs: 10 });
      registry.observeHttpRequest({ method: 'POST', route: '/slow', rawPath: '/slow?x=1', statusCode: 200, durationMs: 800 });
      registry.observeHttpRequest({ method: 'POST', route: '/slow', rawPath: '/slow?x=2', statusCode: 200, durationMs: 1500 });

      const out = registry.outliers();
      expect(out).toHaveLength(2);
      // newest first
      expect(out[0].durationMs).toBe(1500);
      expect(out[0].rawPath).toBe('/slow?x=2');
      expect(out[1].durationMs).toBe(800);
    });

    it('does NOT capture SSE long-poll routes even when slow', () => {
      // SSE subscribe routes take 5 minutes by design
      registry.observeHttpRequest({
        method: 'GET',
        route: '/msg/:channel/subscribe',
        rawPath: '/msg/foo/subscribe',
        statusCode: 200,
        durationMs: 300_000,
      });
      registry.observeHttpRequest({
        method: 'GET',
        route: '/dashboard/events',
        rawPath: '/dashboard/events',
        statusCode: 200,
        durationMs: 60_000,
      });
      registry.observeHttpRequest({
        method: 'GET',
        route: '/activity/subscribe',
        rawPath: '/activity/subscribe',
        statusCode: 200,
        durationMs: 300_000,
      });
      registry.observeHttpRequest({
        method: 'GET',
        route: '/fleet/events',
        rawPath: '/fleet/events',
        statusCode: 200,
        durationMs: 300_000,
      });
      // But a real outlier on a different route should still land
      registry.observeHttpRequest({ method: 'POST', route: '/spawn', rawPath: '/spawn', statusCode: 200, durationMs: 5000 });

      const out = registry.outliers();
      expect(out).toHaveLength(1);
      expect(out[0].route).toBe('/spawn');
    });

    it('DOES capture slow non-SSE list endpoints whose template happens to end in /events', () => {
      // Regression for the substring matcher that previously skipped these:
      // /usage/events and /webhooks/events are list endpoints, NOT SSE streams.
      // A slow request to either one should still surface as an outlier.
      registry.observeHttpRequest({
        method: 'GET',
        route: '/usage/events',
        rawPath: '/usage/events?limit=500',
        statusCode: 200,
        durationMs: 1200,
      });
      registry.observeHttpRequest({
        method: 'GET',
        route: '/webhooks/events',
        rawPath: '/webhooks/events',
        statusCode: 200,
        durationMs: 800,
      });

      const out = registry.outliers();
      const routes = out.map(o => o.route).sort();
      expect(routes).toEqual(['/usage/events', '/webhooks/events']);
    });

    it('honors the limit parameter', () => {
      for (let i = 0; i < 50; i++) {
        registry.observeHttpRequest({ method: 'GET', route: '/x', rawPath: '/x', statusCode: 200, durationMs: 600 });
      }
      expect(registry.outliers(10)).toHaveLength(10);
      expect(registry.outliers(100).length).toBeGreaterThanOrEqual(50);
    });
  });

  // ── prometheus text format ───────────────────────────────────────────────
  describe('toPrometheus', () => {
    it('emits HELP+TYPE comments before each metric family', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/x', rawPath: '/x', statusCode: 200, durationMs: 5 });
      const text = registry.toPrometheus();
      expect(text).toMatch(/# HELP port_daddy_http_requests_total/);
      expect(text).toMatch(/# TYPE port_daddy_http_requests_total counter/);
      expect(text).toMatch(/# HELP port_daddy_http_request_duration_ms/);
      expect(text).toMatch(/# TYPE port_daddy_http_request_duration_ms histogram/);
    });

    it('emits cumulative bucket counts (Prometheus convention)', () => {
      // Two samples: one in 1ms bucket, one in 100ms bucket
      registry.observeHttpRequest({ method: 'GET', route: '/y', rawPath: '/y', statusCode: 200, durationMs: 0.5 });
      registry.observeHttpRequest({ method: 'GET', route: '/y', rawPath: '/y', statusCode: 200, durationMs: 80 });

      const text = registry.toPrometheus();
      // Cumulative: le=1 should have 1 obs, le=100 should have 2 obs, le=+Inf should have 2
      const le1   = text.match(/duration_ms_bucket\{[^}]*le="1"\} (\d+)/);
      const le100 = text.match(/duration_ms_bucket\{[^}]*le="100"\} (\d+)/);
      const leInf = text.match(/duration_ms_bucket\{[^}]*le="\+Inf"\} (\d+)/);
      expect(parseInt(le1[1], 10)).toBe(1);
      expect(parseInt(le100[1], 10)).toBe(2);
      expect(parseInt(leInf[1], 10)).toBe(2);
    });

    it('escapes label values to keep the text format valid', () => {
      // a route containing a quote would break the format if not escaped
      registry.observeHttpRequest({
        method: 'GET',
        route: '/routes/with"quote',
        rawPath: '/routes/with"quote',
        statusCode: 200,
        durationMs: 1,
      });
      const text = registry.toPrometheus();
      expect(text).toMatch(/route="\/routes\/with\\"quote"/);
    });

    it('exposes process metrics (heap, rss, event-loop lag, uptime)', () => {
      const text = registry.toPrometheus();
      expect(text).toMatch(/port_daddy_process_heap_used_bytes \d+/);
      expect(text).toMatch(/port_daddy_process_rss_bytes \d+/);
      expect(text).toMatch(/port_daddy_event_loop_lag_ms /);
      expect(text).toMatch(/port_daddy_uptime_seconds /);
    });
  });

  // ── generic counters ─────────────────────────────────────────────────────
  describe('incCounter', () => {
    it('aggregates by label set', () => {
      registry.incCounter('foo_total', 'foo help', { kind: 'a' });
      registry.incCounter('foo_total', 'foo help', { kind: 'a' });
      registry.incCounter('foo_total', 'foo help', { kind: 'b' });

      const text = registry.toPrometheus();
      expect(text).toMatch(/foo_total\{kind="a"\} 2/);
      expect(text).toMatch(/foo_total\{kind="b"\} 1/);
    });
  });

  // ── snapshot shape ───────────────────────────────────────────────────────
  describe('snapshot', () => {
    it('returns a stable shape suitable for the dashboard', () => {
      const snap = registry.snapshot();
      expect(snap).toHaveProperty('generatedAt');
      expect(snap).toHaveProperty('startedAt');
      expect(snap).toHaveProperty('process');
      expect(snap.process).toHaveProperty('heapUsedMB');
      expect(snap.process).toHaveProperty('eventLoopLagMs');
      expect(snap.process).toHaveProperty('uptimeSec');
      expect(Array.isArray(snap.routes)).toBe(true);
      expect(Array.isArray(snap.outliers)).toBe(true);
    });

    it('sorts routes by total time descending', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/cheap', rawPath: '/cheap', statusCode: 200, durationMs: 1 });
      for (let i = 0; i < 10; i++) {
        registry.observeHttpRequest({ method: 'GET', route: '/expensive', rawPath: '/expensive', statusCode: 200, durationMs: 100 });
      }
      const snap = registry.snapshot();
      expect(snap.routes[0].route).toBe('/expensive');
    });
  });

  // ── reset ───────────────────────────────────────────────────────────────
  describe('reset', () => {
    it('clears all series and outliers', () => {
      registry.observeHttpRequest({ method: 'GET', route: '/a', rawPath: '/a', statusCode: 200, durationMs: 600 });
      expect(registry.snapshot().routes.length).toBe(1);
      expect(registry.outliers().length).toBe(1);
      registry.reset();
      expect(registry.snapshot().routes.length).toBe(0);
      expect(registry.outliers().length).toBe(0);
    });
  });
});
