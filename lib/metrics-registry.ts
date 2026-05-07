/**
 * Metrics Registry — Prometheus-compatible HTTP histograms + counters.
 *
 * Why this exists:
 *   The previous request-logging hook wrote a JSON line to a winston file on every
 *   request. That file grew to 625 MB without rotation, and the synchronous-ish
 *   serialization was itself a latency contributor. This module replaces the firehose
 *   with bounded-memory aggregates: a counter + histogram per (method, route, status_class)
 *   plus a small ring buffer of recent outliers for forensic queries.
 *
 * What it exposes:
 *   - Prometheus 0.0.4 text exposition via toPrometheus() — drop-in for Grafana scrape.
 *   - JSON snapshot via snapshot() for the in-house charts dashboard.
 *   - outliers() returns the most recent slow requests for the dashboard outlier panel.
 *   - Process metrics (heap, RSS, event-loop lag) so daemon-side saturation is visible.
 *
 * Cardinality control:
 *   Routes are the Fastify route TEMPLATE (e.g. "/projects/:id"), never the raw URL.
 *   Status is bucketed to "2xx" / "3xx" / "4xx" / "5xx" rather than the exact code.
 *   Without these two rules the metric series count would explode under random IDs.
 */

import { performance } from 'node:perf_hooks';

// ─── Buckets ──────────────────────────────────────────────────────────────────
// De-facto Prometheus default for HTTP latency, in milliseconds.
// Spans the realistic range from "in-memory cache hit" (1ms) to "stuck spawn" (60s).
const DEFAULT_BUCKETS_MS: readonly number[] = [
  1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
];

const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;
type StatusClass = typeof STATUS_CLASSES[number];

function statusClassOf(code: number): StatusClass {
  if (code >= 500) return '5xx';
  if (code >= 400) return '4xx';
  if (code >= 300) return '3xx';
  return '2xx';
}

// ─── Per-series histogram ─────────────────────────────────────────────────────
interface SeriesKey { method: string; route: string; status: StatusClass }

interface Series {
  key: SeriesKey;
  count: number;
  sumMs: number;
  bucketCounts: number[];           // one slot per DEFAULT_BUCKETS_MS, last is +Inf
  // Reservoir of last N samples for accurate recent-percentile reporting.
  // Bounded ring buffer; older samples are overwritten.
  ring: Float64Array;
  ringIdx: number;
  ringFilled: boolean;
}

const RING_SIZE = 1000;

function newSeries(key: SeriesKey): Series {
  return {
    key,
    count: 0,
    sumMs: 0,
    bucketCounts: new Array(DEFAULT_BUCKETS_MS.length + 1).fill(0),
    ring: new Float64Array(RING_SIZE),
    ringIdx: 0,
    ringFilled: false,
  };
}

function observeSeries(s: Series, durationMs: number): void {
  s.count += 1;
  s.sumMs += durationMs;

  // Linear scan is fast enough for 15 buckets; binary search not worth the code.
  let placed = false;
  for (let i = 0; i < DEFAULT_BUCKETS_MS.length; i++) {
    if (durationMs <= DEFAULT_BUCKETS_MS[i]) {
      s.bucketCounts[i] += 1;
      placed = true;
      break;
    }
  }
  if (!placed) s.bucketCounts[DEFAULT_BUCKETS_MS.length] += 1;  // +Inf bucket

  s.ring[s.ringIdx] = durationMs;
  s.ringIdx = (s.ringIdx + 1) % RING_SIZE;
  if (s.ringIdx === 0) s.ringFilled = true;
}

function ringSamples(s: Series): number[] {
  const len = s.ringFilled ? RING_SIZE : s.ringIdx;
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[i] = s.ring[i];
  return out;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

// ─── Outlier ring ─────────────────────────────────────────────────────────────
export interface Outlier {
  ts: number;
  method: string;
  route: string;
  rawPath: string;
  status: number;
  durationMs: number;
}

const OUTLIER_RING_SIZE = 500;

// ─── Generic counters (for non-HTTP metrics like spawn.started passthrough) ────
interface GenericCounter {
  name: string;
  help: string;
  labelKeys: string[];
  // serialized label values → count
  series: Map<string, number>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────
export interface MetricsRegistry {
  observeHttpRequest(opts: {
    method: string;
    route: string;          // Fastify route TEMPLATE — never the raw URL
    rawPath: string;        // for outlier forensics
    statusCode: number;
    durationMs: number;
  }): void;

  /** Increment a labelled counter. Labels must be stable & low-cardinality. */
  incCounter(name: string, help: string, labels: Record<string, string>, by?: number): void;

  toPrometheus(): string;
  snapshot(): RegistrySnapshot;
  outliers(limit?: number): Outlier[];
  reset(): void;
}

export interface RouteSnapshot {
  method: string;
  route: string;
  status: StatusClass;
  count: number;
  sumMs: number;
  meanMs: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
  buckets: { le: number | '+Inf'; count: number }[];
}

export interface RegistrySnapshot {
  generatedAt: number;
  startedAt: number;
  process: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
    eventLoopLagMs: number;
    uptimeSec: number;
  };
  routes: RouteSnapshot[];
  outliers: Outlier[];
}

export function createMetricsRegistry(): MetricsRegistry {
  const startedAt = Date.now();
  const series = new Map<string, Series>();
  const counters = new Map<string, GenericCounter>();

  const outlierRing: Outlier[] = new Array(OUTLIER_RING_SIZE);
  let outlierIdx = 0;
  let outlierFilled = false;

  // Event-loop lag sampler. Schedules itself with setTimeout(0) and measures
  // how late the callback is — that delta is the lag. Cheap (one timer/sec).
  let eventLoopLagMs = 0;
  function sampleLoopLag() {
    const expected = performance.now();
    setTimeout(() => {
      eventLoopLagMs = Math.max(0, performance.now() - expected - 1000);
      sampleLoopLag();
    }, 1000).unref();
  }
  sampleLoopLag();

  function seriesKeyHash(k: SeriesKey): string {
    return `${k.method}\x00${k.route}\x00${k.status}`;
  }

  function getOrCreateSeries(k: SeriesKey): Series {
    const hash = seriesKeyHash(k);
    let s = series.get(hash);
    if (!s) {
      s = newSeries(k);
      series.set(hash, s);
    }
    return s;
  }

  function observeHttpRequest(opts: {
    method: string;
    route: string;
    rawPath: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const status = statusClassOf(opts.statusCode);
    const s = getOrCreateSeries({ method: opts.method, route: opts.route, status });
    observeSeries(s, opts.durationMs);

    // Outlier capture: anything taking > 500 ms is forensic-worthy.
    // Don't capture SSE / long-poll subscribe routes — those are by design.
    const isLongPoll = opts.route.includes('/subscribe') || opts.route.includes('/events');
    if (opts.durationMs >= 500 && !isLongPoll) {
      outlierRing[outlierIdx] = {
        ts: Date.now(),
        method: opts.method,
        route: opts.route,
        rawPath: opts.rawPath,
        status: opts.statusCode,
        durationMs: +opts.durationMs.toFixed(2),
      };
      outlierIdx = (outlierIdx + 1) % OUTLIER_RING_SIZE;
      if (outlierIdx === 0) outlierFilled = true;
    }
  }

  function incCounter(name: string, help: string, labels: Record<string, string>, by = 1): void {
    let c = counters.get(name);
    if (!c) {
      c = { name, help, labelKeys: Object.keys(labels).sort(), series: new Map() };
      counters.set(name, c);
    }
    // Stable label serialization for series identity
    const labelHash = c.labelKeys.map(k => `${k}=${labels[k] ?? ''}`).join('|');
    c.series.set(labelHash, (c.series.get(labelHash) ?? 0) + by);
  }

  function snapshot(): RegistrySnapshot {
    const mem = process.memoryUsage();
    const routes: RouteSnapshot[] = [];

    for (const s of series.values()) {
      const samples = ringSamples(s);
      samples.sort((a, b) => a - b);
      routes.push({
        method: s.key.method,
        route: s.key.route,
        status: s.key.status,
        count: s.count,
        sumMs: +s.sumMs.toFixed(2),
        meanMs: +(s.sumMs / Math.max(1, s.count)).toFixed(2),
        p50: +percentile(samples, 0.50).toFixed(2),
        p95: +percentile(samples, 0.95).toFixed(2),
        p99: +percentile(samples, 0.99).toFixed(2),
        maxMs: samples.length > 0 ? +samples[samples.length - 1].toFixed(2) : 0,
        buckets: [
          ...DEFAULT_BUCKETS_MS.map((le, i): { le: number | '+Inf'; count: number } => ({ le, count: s.bucketCounts[i] })),
          { le: '+Inf' as const, count: s.bucketCounts[DEFAULT_BUCKETS_MS.length] },
        ],
      });
    }
    routes.sort((a, b) => b.sumMs - a.sumMs);

    return {
      generatedAt: Date.now(),
      startedAt,
      process: {
        heapUsedMB: +(mem.heapUsed / 1048576).toFixed(2),
        heapTotalMB: +(mem.heapTotal / 1048576).toFixed(2),
        rssMB: +(mem.rss / 1048576).toFixed(2),
        eventLoopLagMs: +eventLoopLagMs.toFixed(2),
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      },
      routes,
      outliers: outliers(),
    };
  }

  function outliers(limit = 100): Outlier[] {
    const len = outlierFilled ? OUTLIER_RING_SIZE : outlierIdx;
    const out: Outlier[] = [];
    for (let i = 0; i < len; i++) {
      const sample = outlierRing[(outlierIdx - 1 - i + OUTLIER_RING_SIZE) % OUTLIER_RING_SIZE];
      if (sample) out.push(sample);
      if (out.length >= limit) break;
    }
    return out;
  }

  function escapeLabelValue(v: string): string {
    return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }

  function toPrometheus(): string {
    const lines: string[] = [];
    const mem = process.memoryUsage();

    // ── Process metrics ──
    lines.push('# HELP port_daddy_process_heap_used_bytes Process heap used in bytes');
    lines.push('# TYPE port_daddy_process_heap_used_bytes gauge');
    lines.push(`port_daddy_process_heap_used_bytes ${mem.heapUsed}`);

    lines.push('# HELP port_daddy_process_rss_bytes Process resident set size in bytes');
    lines.push('# TYPE port_daddy_process_rss_bytes gauge');
    lines.push(`port_daddy_process_rss_bytes ${mem.rss}`);

    lines.push('# HELP port_daddy_event_loop_lag_ms Event loop lag in milliseconds (sampled every 1s)');
    lines.push('# TYPE port_daddy_event_loop_lag_ms gauge');
    lines.push(`port_daddy_event_loop_lag_ms ${eventLoopLagMs.toFixed(3)}`);

    lines.push('# HELP port_daddy_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE port_daddy_uptime_seconds counter');
    lines.push(`port_daddy_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`);

    // ── HTTP request totals ──
    lines.push('# HELP port_daddy_http_requests_total Total HTTP requests by method, route template, and status class');
    lines.push('# TYPE port_daddy_http_requests_total counter');
    for (const s of series.values()) {
      const labels = `method="${escapeLabelValue(s.key.method)}",route="${escapeLabelValue(s.key.route)}",status="${s.key.status}"`;
      lines.push(`port_daddy_http_requests_total{${labels}} ${s.count}`);
    }

    // ── HTTP request duration histogram ──
    lines.push('# HELP port_daddy_http_request_duration_ms HTTP request latency in milliseconds');
    lines.push('# TYPE port_daddy_http_request_duration_ms histogram');
    for (const s of series.values()) {
      const baseLabels = `method="${escapeLabelValue(s.key.method)}",route="${escapeLabelValue(s.key.route)}",status="${s.key.status}"`;
      // Cumulative buckets per Prometheus convention (each bucket counts all observations <= le)
      let cumulative = 0;
      for (let i = 0; i < DEFAULT_BUCKETS_MS.length; i++) {
        cumulative += s.bucketCounts[i];
        lines.push(`port_daddy_http_request_duration_ms_bucket{${baseLabels},le="${DEFAULT_BUCKETS_MS[i]}"} ${cumulative}`);
      }
      cumulative += s.bucketCounts[DEFAULT_BUCKETS_MS.length];
      lines.push(`port_daddy_http_request_duration_ms_bucket{${baseLabels},le="+Inf"} ${cumulative}`);
      lines.push(`port_daddy_http_request_duration_ms_count{${baseLabels}} ${s.count}`);
      lines.push(`port_daddy_http_request_duration_ms_sum{${baseLabels}} ${s.sumMs.toFixed(3)}`);
    }

    // ── Generic counters ──
    for (const c of counters.values()) {
      lines.push(`# HELP ${c.name} ${c.help}`);
      lines.push(`# TYPE ${c.name} counter`);
      for (const [labelHash, value] of c.series.entries()) {
        const labels = labelHash
          .split('|')
          .map(p => {
            const eqIdx = p.indexOf('=');
            const k = p.slice(0, eqIdx);
            const v = p.slice(eqIdx + 1);
            return `${k}="${escapeLabelValue(v)}"`;
          })
          .join(',');
        lines.push(`${c.name}{${labels}} ${value}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  function reset(): void {
    series.clear();
    counters.clear();
    outlierIdx = 0;
    outlierFilled = false;
  }

  return { observeHttpRequest, incCounter, toPrometheus, snapshot, outliers, reset };
}
