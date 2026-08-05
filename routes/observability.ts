/**
 * Observability Routes — counters + cost tracking endpoints.
 *
 * GET /metrics/counters              — summary of all counters (last 24h default)
 * GET /metrics/counters/top          — top N dimension values for a key
 * GET /metrics/cost                  — cost summary by project label/projectDir + by backend
 * GET /metrics/cost/recent           — most recent N cost events
 * GET /metrics/cost/budget/:project  — budget check for a project
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import type { Counters } from '../lib/counters.js';
import type { CostTracker } from '../lib/cost-tracker.js';
import type { CloudAppTelemetry } from '../lib/cloud-app-telemetry.js';

interface ObservabilityDeps {
  counters: Counters;
  costTracker: CostTracker;
  cloudAppTelemetry?: CloudAppTelemetry;
}

export const observabilityPlugin: FastifyPluginAsync<{ deps: ObservabilityDeps }> = async (fastify, opts) => {
  const { counters, costTracker, cloudAppTelemetry } = opts.deps;

  /** Parse `?since=N` (seconds ago) into epoch ms. Returns undefined when absent and no default given. */
  function parseSince(q: Record<string, string>, defaultSecs?: number): number | undefined {
    const raw = q.since ? parseInt(q.since, 10) : defaultSecs;
    return raw !== undefined ? Date.now() - raw * 1_000 : undefined;
  }

  // ── Counters ──────────────────────────────────────────────────────────────

  /**
   * GET /metrics/counters
   * ?key=spawn.started   filter to one key (returns time-bucketed results)
   * ?since=3600          seconds in the past (default: 86400 = 24h)
   * ?groupBy=hour        bucket by hour instead of minute
   */
  fastify.get('/metrics/counters', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const sinceSecs = q.since ? parseInt(q.since, 10) : 86_400;
    const since = Date.now() - sinceSecs * 1_000;

    if (q.key) {
      const groupBy = q.groupBy === 'hour' ? 'hour' as const : 'minute' as const;
      return {
        key: q.key, since, groupBy,
        results: counters.query({ key: q.key, since, groupBy }),
      };
    }

    return { since, counters: counters.summary(since) };
  });

  /**
   * GET /metrics/counters/top?key=spawn.started&dim=backend&n=10&since=3600
   * Returns top N dimension values sorted by count.
   */
  fastify.get('/metrics/counters/top', async (request: FastifyRequest, reply: FastifyReply) => {
    const q = request.query as Record<string, string>;
    if (!q.key || !q.dim) {
      reply.code(400);
      return { error: 'key and dim query params are required' };
    }
    const since = parseSince(q);
    const n = Math.min(parseInt(q.n ?? '10', 10), 100);
    return { key: q.key, dim: q.dim, results: counters.topN(q.key, q.dim, n, since) };
  });

  // ── Golden Signals (RED method for fleet spawns) ──────────────────────────

  /**
   * GET /metrics/golden
   * Four golden signals for the spawn system, per the RED method:
   *   Rate:        spawns per minute (last 5m window)
   *   Errors:      failure percentage (last 1h)
   *   Duration:    avg spawn latency ms (last 1h)
   *   Saturation:  not available here (fleet-engine tracks active/limit ratio)
   *
   * Also returns burn rate: what fraction of the hourly spawn budget is consumed.
   */
  fastify.get('/metrics/golden', async () => {
    const now = Date.now();
    const oneHourAgo = now - 3_600_000;
    const fiveMinAgo  = now - 300_000;

    // Rate: spawns in last 5 min → extrapolated to /min.
    // Separate query because it uses a different time window (5m vs 1h).
    const recentStarted = counters.query({ key: 'spawn.started', since: fiveMinAgo, groupBy: 'minute' });
    const ratePerMin    = +(recentStarted.reduce((s, r) => s + r.value, 0) / 5).toFixed(2);

    // All 1-hour metrics in a single SQL round-trip (was 5 separate query() calls).
    const hourKeys = ['spawn.started', 'spawn.failed', 'spawn.cancelled', 'spawn.duration_ms', 'spawn.completed'];
    const hourTotals = counters.queryTotals(hourKeys, { since: oneHourAgo, groupBy: 'hour' });
    const totalStarted  = hourTotals.get('spawn.started')    ?? 0;
    const totalFailed   = (hourTotals.get('spawn.failed') ?? 0) + (hourTotals.get('spawn.cancelled') ?? 0);
    const totalDuration = hourTotals.get('spawn.duration_ms') ?? 0;
    const totalComplete = hourTotals.get('spawn.completed')   ?? 0;

    const errorPct      = totalStarted > 0 ? +((totalFailed / totalStarted) * 100).toFixed(2) : 0;
    const avgDurationMs = totalComplete > 0 ? Math.round(totalDuration / totalComplete) : null;

    // Burn rate: cost spend rate vs. "normal" baseline
    const costTotal   = costTracker.total({ since: oneHourAgo });
    const costPerHour = +costTotal.totalUsd.toFixed(6);

    return {
      ratePerMin,
      errorPct,
      avgDurationMs,
      costPerHour,
      window: { rateWindowSecs: 300, metricWindowSecs: 3600 },
      counts: {
        started: totalStarted,
        completed: totalComplete,
        failed: totalFailed,
      },
    };
  });

  // ── Cost ─────────────────────────────────────────────────────────────────

  /**
   * GET /metrics/cost
   * ?since=86400         seconds in the past (default: 86400 = 24h)
   * ?project=myapp       filter to one project
   *
   * Returns spend buckets, not live-fleet truth. Use /fleet for current fleets.
   * Returns: { totals, byProject, byBackend }
   */
  fastify.get('/metrics/cost', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const sinceSecs = q.since ? parseInt(q.since, 10) : 86_400;
    const since = parseSince(q, 86_400)!;

    const totals = costTracker.total({ since });
    const byProject = costTracker.summary({ since, projectName: q.project });
    const byBackend = costTracker.byBackend({ since });
    const remoteSummary = cloudAppTelemetry?.summary({ since, limit: 20 }) ?? null;
    const remote = cloudAppTelemetry
      ? { cloudApp: remoteSummary }
      : { cloudApp: null };
    const combinedTotals = {
      totalUsd: +Number(totals.totalUsd + (remoteSummary?.totals.costUsd ?? 0)).toFixed(6),
      localUsd: totals.totalUsd,
      remoteUsd: remoteSummary?.totals.costUsd ?? 0,
      localSpawnCount: totals.spawnCount,
      remoteEventCount: remoteSummary?.totals.events ?? 0,
      remoteShipEventCount: remoteSummary?.totals.shipEvents ?? 0,
      estimatedCount: totals.estimatedCount + (remoteSummary?.totals.estimatedCostEvents ?? 0),
      unknownRemoteCostEvents: remoteSummary?.totals.unknownCostEvents ?? 0,
    };

    return { since, periodSecs: sinceSecs, totals, byProject, byBackend, remote, combinedTotals };
  });

  /**
   * GET /metrics/cost/recent?limit=50
   * Most recent cost events (useful for live cost feed).
   */
  fastify.get('/metrics/cost/recent', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const limit = Math.min(parseInt(q.limit ?? '50', 10), 200);
    return { events: costTracker.recent(limit) };
  });

  /**
   * GET /metrics/cost/budget/:project?budgetUsdPerDay=2.5&since=86400
   * Check a project's spend vs. a budget ceiling.
   * ?budgetUsdPerDay=2.5  required budget in USD per day
   * ?since=86400  window in seconds (default 24h)
   */
  fastify.get('/metrics/cost/budget/:project', async (request: FastifyRequest, reply: FastifyReply) => {
    const { project } = request.params as { project: string };
    const q = request.query as Record<string, string>;
    const budgetUsdPerDay = parseFloat(q.budgetUsdPerDay ?? '');
    if (!Number.isFinite(budgetUsdPerDay) || budgetUsdPerDay <= 0) {
      reply.code(400);
      return { error: 'budgetUsdPerDay query param is required and must be > 0' };
    }
    return costTracker.budgetStatus(project, budgetUsdPerDay, parseSince(q));
  });
};
