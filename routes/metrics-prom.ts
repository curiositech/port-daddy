/**
 * Prometheus + JSON metrics routes.
 *
 * GET /metrics/prom               Prometheus 0.0.4 text exposition (scrapeable by Grafana/VictoriaMetrics)
 *                                 Configure scrapers with metrics_path: /metrics/prom — the bare
 *                                 /metrics path is occupied by the older JSON daemon-stats endpoint
 *                                 (info.ts) which the SDK, MCP, and CLI diagnostics depend on.
 * GET /metrics/http/routes        JSON snapshot of per-route histograms (used by /metrics-charts dashboard)
 * GET /metrics/http/outliers      Recent slow requests, newest first
 * GET /metrics/annotations        Time-aligned annotation events: git commits + recent pd notes
 *                                 + session purposes (telos). Used to overlay context on charts.
 *
 * Coexists with routes/observability.ts which is the older counters-based view.
 * This plugin is the fast in-memory path; observability.ts is the SQLite rollup.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { execFileSync } from 'node:child_process';
import type { MetricsRegistry } from '../lib/metrics-registry.js';
import type { Database } from 'better-sqlite3';

interface MetricsRouteDeps {
  metricsRegistry: MetricsRegistry;
  db: Database;
  repoRoot: string;
}

interface AnnotationEvent {
  ts: number;
  kind: 'commit' | 'tag' | 'note' | 'session_purpose' | 'spawn';
  title: string;
  detail?: string;
  ref?: string;     // git sha, session id, etc.
}

export const metricsPromPlugin: FastifyPluginAsync<{ deps: MetricsRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { metricsRegistry, db, repoRoot } = opts.deps;

  // ── /metrics/prom — Prometheus text ─────────────────────────────────────────
  fastify.get('/metrics/prom', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return metricsRegistry.toPrometheus();
  });

  // ── /metrics/http/routes — JSON snapshot for the dashboard ──────────────────
  fastify.get('/metrics/http/routes', async () => {
    return metricsRegistry.snapshot();
  });

  // ── /metrics/http/outliers — recent slow requests ───────────────────────────
  fastify.get('/metrics/http/outliers', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? '100', 10), 500);
    return { outliers: metricsRegistry.outliers(limit) };
  });

  // ── /metrics/annotations — overlay context on time series ───────────────────
  /**
   * Returns events that map onto the charts page time axis: git commits
   * (deploy markers), version tags, recent pd notes (agent activity), and
   * session purposes (the "telos" — what an agent set out to do).
   *
   * ?since=N      seconds back (default 86400 = 24h)
   * ?limit=N      cap the response (default 200)
   */
  fastify.get('/metrics/annotations', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const sinceSecs = q.since ? parseInt(q.since, 10) : 86_400;
    const sinceMs = Date.now() - sinceSecs * 1_000;
    const limit = Math.min(parseInt(q.limit ?? '200', 10), 1000);

    const events: AnnotationEvent[] = [];

    // ── Git commits / tags ──
    // Use a single git log call with a chosen format. Errors are non-fatal —
    // metrics works without git history (just an empty annotations layer).
    try {
      const since = `--since=${Math.ceil(sinceSecs / 3600)} hours ago`;
      const fmt = '--pretty=format:%H%x1f%ct%x1f%s%x1f%d';   // sha | committed-ts | subject | refs
      const raw = execFileSync('git', ['log', since, fmt, '--no-merges'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        timeout: 5000,
      });
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        const [sha, cts, subject, refs] = line.split('\x1f');
        const ts = parseInt(cts, 10) * 1000;
        if (!Number.isFinite(ts) || ts < sinceMs) continue;
        // Treat tagged commits as "version" events
        const tagMatch = (refs ?? '').match(/tag:\s*([^,)]+)/);
        events.push({
          ts,
          kind: tagMatch ? 'tag' : 'commit',
          title: tagMatch ? tagMatch[1].trim() : subject.slice(0, 80),
          detail: tagMatch ? subject.slice(0, 200) : undefined,
          ref: sha.slice(0, 8),
        });
      }
    } catch {
      // not in a git repo, or git missing — annotations layer just becomes thinner
    }

    // ── pd notes (last N) ──
    // Recent notes carry "what an agent did/intends". Pull from session_notes
    // joined with sessions for the purpose (telos).
    try {
      const noteRows = db.prepare(`
        SELECT
          n.created_at AS ts,
          n.content    AS content,
          s.purpose    AS session_purpose,
          n.session_id AS session_id
        FROM session_notes n
        LEFT JOIN sessions s ON s.id = n.session_id
        WHERE n.created_at >= ?
        ORDER BY n.created_at DESC
        LIMIT ?
      `).all(sinceMs, limit) as Array<{ ts: number; content: string; session_purpose: string | null; session_id: string }>;

      for (const r of noteRows) {
        events.push({
          ts: r.ts,
          kind: 'note',
          title: (r.session_purpose ?? 'note').slice(0, 80),
          detail: r.content.slice(0, 240),
          ref: r.session_id,
        });
      }
    } catch {
      // session_notes table may not exist on a fresh daemon — skip silently
    }

    // ── Session purposes (telos starts) ──
    try {
      const sessionRows = db.prepare(`
        SELECT id, purpose, created_at
        FROM sessions
        WHERE created_at >= ?
          AND purpose IS NOT NULL
          AND purpose != ''
        ORDER BY created_at DESC
        LIMIT ?
      `).all(sinceMs, Math.min(limit, 100)) as Array<{ id: string; purpose: string; created_at: number }>;

      for (const r of sessionRows) {
        events.push({
          ts: r.created_at,
          kind: 'session_purpose',
          title: r.purpose.slice(0, 80),
          detail: r.purpose.slice(0, 240),
          ref: r.id,
        });
      }
    } catch {
      // sessions table missing — skip
    }

    events.sort((a, b) => b.ts - a.ts);
    return { sinceMs, count: events.length, events: events.slice(0, limit) };
  });

  // ── /metrics — debug stub: who is hitting us right now ─────────────────────
  fastify.get('/metrics/http/now', async () => {
    const snap = metricsRegistry.snapshot();
    const now = Date.now();
    const ageMin = (now - snap.startedAt) / 60_000;
    const totalReq = snap.routes.reduce((s, r) => s + r.count, 0);
    return {
      uptime_min: +ageMin.toFixed(2),
      total_requests: totalReq,
      requests_per_min: ageMin > 0 ? +(totalReq / ageMin).toFixed(2) : 0,
      event_loop_lag_ms: snap.process.eventLoopLagMs,
      heap_used_mb: snap.process.heapUsedMB,
      hot_routes: snap.routes.slice(0, 10).map(r => ({
        method: r.method,
        route: r.route,
        status: r.status,
        count: r.count,
        p95: r.p95,
        p99: r.p99,
        sumMs: r.sumMs,
      })),
    };
  });
};
