/**
 * Prometheus + JSON metrics routes.
 *
 * GET /metrics/prom               Prometheus 0.0.4 text exposition (scrapeable by Grafana/VictoriaMetrics)
 *                                 Configure scrapers with metrics_path: /metrics/prom — the bare
 *                                 /metrics path is occupied by the older JSON daemon-stats endpoint
 *                                 (info.ts) which the SDK, MCP, and CLI diagnostics depend on.
 * GET /metrics/skills             JSON snapshot of skill freshness and cross-runtime distribution
 * GET /metrics/http/routes        JSON snapshot of per-route histograms (used by /metrics.html dashboard)
 * GET /metrics/http/outliers      Recent slow requests, newest first
 * GET /metrics/annotations        Time-aligned annotation events: git commits + recent pd notes
 *                                 + session purposes (telos). Used to overlay context on charts.
 *
 * Coexists with routes/observability.ts which is the older counters-based view.
 * This plugin is the fast in-memory path; observability.ts is the SQLite rollup.
 */

import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import type { MetricsRegistry } from '../lib/metrics-registry.js';
import type { Database } from 'better-sqlite3';
import {
  formatSkillSyncSummary,
  syncAgentSkills,
  type RuntimeSkillTarget,
  type SkillCatalogRoot,
  type SyncAgentSkillsResult,
  type SkillSyncScope,
} from '../lib/skill-sync.js';

interface MetricsRouteDeps {
  metricsRegistry: MetricsRegistry;
  db: Database;
  repoRoot: string;
  skillDistribution?: SkillDistributionConfig;
}

interface SkillDistributionConfig {
  audit?: () => SyncAgentSkillsResult;
  baseDir?: string;
  projectRoot?: string;
  scope?: SkillSyncScope;
  sourceRoots?: SkillCatalogRoot[];
  targets?: RuntimeSkillTarget[];
  cacheTtlMs?: number;
}

interface AnnotationEvent {
  ts: number;
  kind: 'commit' | 'tag' | 'note' | 'session_purpose' | 'spawn';
  title: string;
  detail?: string;
  ref?: string;     // git sha, session id, etc.
}

interface SkillDistributionMetrics {
  generatedAt: number;
  status: 'fresh' | 'drift' | 'error';
  scope: SkillSyncScope;
  skillCount: number;
  sourceCount: number;
  targetCount: number;
  expectedLinks: number;
  currentLinks: number;
  missingLinks: number;
  staleSymlinks: number;
  blockedNonSymlinks: number;
  errorCount: number;
  freshnessPct: number;
  sources: Array<{ label: string; path: string }>;
  targets: Array<{ label: string; path: string }>;
  collisions: number;
  examples: SyncAgentSkillsResult['audit']['examples'];
  summary: string[];
  error?: string;
}

// ─── Query-param helpers ─────────────────────────────────────────────────────
/**
 * Parse a positive-integer query param with a default and a hard cap.
 * Returns the default for missing, NaN, negative, or non-finite inputs.
 * Rejecting bad inputs by silently falling back to the default is fine here
 * because both endpoints accepting these params (outliers / annotations)
 * have safe, well-defined defaults.
 */
function parseBoundedInt(raw: string | undefined, fallback: number, cap: number): number {
  if (raw === undefined || raw === '') return Math.min(fallback, cap);
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return Math.min(fallback, cap);
  return Math.min(n, cap);
}

// ─── Async git annotation cache ──────────────────────────────────────────────
// /metrics/annotations is polled once a minute from each open dashboard. Each
// call shells out to `git log` over the whole repo, which can take many
// seconds on a large checkout. Doing this *synchronously* in a request handler
// blocks the Node event loop for the daemon's other clients. Solution:
//   1. Use spawn() (async) instead of execFileSync.
//   2. Cache results in-process for ANNOTATION_TTL_MS so repeated dashboard
//      polls share a single git invocation.
const ANNOTATION_TTL_MS = 30_000;
const SKILL_AUDIT_TTL_MS = 60_000;
type GitAnnotationCacheKey = string;
interface CachedGit { ts: number; events: AnnotationEvent[] }
const gitAnnotationCache = new Map<GitAnnotationCacheKey, CachedGit>();
const inflight = new Map<GitAnnotationCacheKey, Promise<AnnotationEvent[]>>();

function runGit(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
      if (code !== 0) return reject(new Error(`git exited ${code}: ${stderr.trim()}`));
      resolve(stdout);
    });
  });
}

async function loadGitAnnotations(repoRoot: string, sinceSecs: number, sinceMs: number): Promise<AnnotationEvent[]> {
  const cacheKey: GitAnnotationCacheKey = `${repoRoot}|${Math.ceil(sinceSecs / 3600)}`;
  const cached = gitAnnotationCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < ANNOTATION_TTL_MS) {
    return cached.events.filter(e => e.ts >= sinceMs);
  }
  // Coalesce concurrent requests into a single git invocation.
  let pending = inflight.get(cacheKey);
  if (!pending) {
    pending = (async () => {
      try {
        const since = `--since=${Math.ceil(sinceSecs / 3600)} hours ago`;
        const fmt = '--pretty=format:%H%x1f%ct%x1f%s%x1f%d';   // sha | committed-ts | subject | refs
        const raw = await runGit(repoRoot, ['log', since, fmt, '--no-merges'], 5000);
        const events: AnnotationEvent[] = [];
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          const [sha, cts, subject, refs] = line.split('\x1f');
          const ts = Number.parseInt(cts, 10) * 1000;
          if (!Number.isFinite(ts)) continue;
          const tagMatch = (refs ?? '').match(/tag:\s*([^,)]+)/);
          events.push({
            ts,
            kind: tagMatch ? 'tag' : 'commit',
            title: tagMatch ? tagMatch[1].trim() : subject.slice(0, 80),
            detail: tagMatch ? subject.slice(0, 200) : undefined,
            ref: sha.slice(0, 8),
          });
        }
        gitAnnotationCache.set(cacheKey, { ts: Date.now(), events });
        return events;
      } catch {
        // Not in a git repo, git missing, or timeout — annotations layer
        // just becomes thinner. Cache the empty result briefly so we don't
        // re-shell out on every poll.
        gitAnnotationCache.set(cacheKey, { ts: Date.now(), events: [] });
        return [];
      } finally {
        inflight.delete(cacheKey);
      }
    })();
    inflight.set(cacheKey, pending);
  }
  const events = await pending;
  return events.filter(e => e.ts >= sinceMs);
}

function toSkillDistribution(result: SyncAgentSkillsResult): SkillDistributionMetrics {
  const audit = result.audit;
  const driftCount = audit.missingLinks + audit.staleSymlinks + audit.blockedNonSymlinks;
  const status = audit.errors.length > 0
    ? 'error'
    : driftCount > 0
      ? 'drift'
      : 'fresh';

  return {
    generatedAt: Date.now(),
    status,
    scope: result.scope,
    skillCount: result.skillCount,
    sourceCount: result.sources.length,
    targetCount: result.targets.length,
    expectedLinks: audit.expectedLinks,
    currentLinks: audit.currentLinks,
    missingLinks: audit.missingLinks,
    staleSymlinks: audit.staleSymlinks,
    blockedNonSymlinks: audit.blockedNonSymlinks,
    errorCount: audit.errors.length,
    freshnessPct: audit.freshnessPct,
    sources: result.sources.map((source) => ({ label: source.label, path: source.path })),
    targets: result.targets.map((target) => ({ label: target.label, path: target.path })),
    collisions: result.collisions.length,
    examples: audit.examples,
    summary: formatSkillSyncSummary(result),
  };
}

function skillDistributionError(scope: SkillSyncScope, error: unknown): SkillDistributionMetrics {
  const message = error instanceof Error ? error.message : String(error);
  return {
    generatedAt: Date.now(),
    status: 'error',
    scope,
    skillCount: 0,
    sourceCount: 0,
    targetCount: 0,
    expectedLinks: 0,
    currentLinks: 0,
    missingLinks: 0,
    staleSymlinks: 0,
    blockedNonSymlinks: 0,
    errorCount: 1,
    freshnessPct: 0,
    sources: [],
    targets: [],
    collisions: 0,
    examples: {
      missing: [],
      staleSymlinks: [],
      blockedNonSymlinks: [],
      errors: [{
        skill: '<audit>',
        runtime: '<metrics>',
        target: '<skill-distribution>',
        source: '<skill-distribution>',
        error: message,
      }],
    },
    summary: [`Skill distribution audit failed: ${message}`],
    error: message,
  };
}

function escapePromLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function skillDistributionPrometheus(metrics: SkillDistributionMetrics): string {
  const scope = escapePromLabel(metrics.scope);
  const labels = `scope="${scope}"`;
  const statusLabels = `scope="${scope}",status="${escapePromLabel(metrics.status)}"`;
  return [
    '# HELP port_daddy_skill_distribution_expected_links Expected runtime skill symlinks for the audited scope',
    '# TYPE port_daddy_skill_distribution_expected_links gauge',
    `port_daddy_skill_distribution_expected_links{${labels}} ${metrics.expectedLinks}`,
    '# HELP port_daddy_skill_distribution_current_links Runtime skill symlinks that point at the selected source of truth',
    '# TYPE port_daddy_skill_distribution_current_links gauge',
    `port_daddy_skill_distribution_current_links{${labels}} ${metrics.currentLinks}`,
    '# HELP port_daddy_skill_distribution_missing_links Expected runtime skill links that are absent',
    '# TYPE port_daddy_skill_distribution_missing_links gauge',
    `port_daddy_skill_distribution_missing_links{${labels}} ${metrics.missingLinks}`,
    '# HELP port_daddy_skill_distribution_stale_symlinks Runtime skill symlinks that point at a stale source',
    '# TYPE port_daddy_skill_distribution_stale_symlinks gauge',
    `port_daddy_skill_distribution_stale_symlinks{${labels}} ${metrics.staleSymlinks}`,
    '# HELP port_daddy_skill_distribution_blocked_non_symlinks Runtime skill targets blocked by local non-symlink files',
    '# TYPE port_daddy_skill_distribution_blocked_non_symlinks gauge',
    `port_daddy_skill_distribution_blocked_non_symlinks{${labels}} ${metrics.blockedNonSymlinks}`,
    '# HELP port_daddy_skill_distribution_errors Audit errors while checking runtime skill distribution',
    '# TYPE port_daddy_skill_distribution_errors gauge',
    `port_daddy_skill_distribution_errors{${labels}} ${metrics.errorCount}`,
    '# HELP port_daddy_skill_distribution_freshness_ratio Current links divided by expected links',
    '# TYPE port_daddy_skill_distribution_freshness_ratio gauge',
    `port_daddy_skill_distribution_freshness_ratio{${labels}} ${(metrics.freshnessPct / 100).toFixed(4)}`,
    '# HELP port_daddy_skill_distribution_status Skill distribution status, labelled fresh, drift, or error',
    '# TYPE port_daddy_skill_distribution_status gauge',
    `port_daddy_skill_distribution_status{${statusLabels}} 1`,
  ].join('\n') + '\n';
}

export const metricsPromPlugin: FastifyPluginAsync<{ deps: MetricsRouteDeps }> = async (
  fastify,
  opts,
) => {
  const { metricsRegistry, db, repoRoot } = opts.deps;
  const skillDistribution = opts.deps.skillDistribution ?? {};
  const skillCacheTtlMs = skillDistribution.cacheTtlMs ?? SKILL_AUDIT_TTL_MS;
  let skillCache: { ts: number; value: SkillDistributionMetrics } | null = null;

  function loadSkillDistribution(): SkillDistributionMetrics {
    const now = Date.now();
    if (skillCache && now - skillCache.ts < skillCacheTtlMs) return skillCache.value;

    const scope = skillDistribution.scope ?? 'user';
    let value: SkillDistributionMetrics;
    try {
      const result = skillDistribution.audit
        ? skillDistribution.audit()
        : syncAgentSkills({
            baseDir: skillDistribution.baseDir ?? homedir(),
            projectRoot: skillDistribution.projectRoot ?? repoRoot,
            scope,
            statusOnly: true,
            sourceRoots: skillDistribution.sourceRoots,
            targets: skillDistribution.targets,
          });
      value = toSkillDistribution(result);
    } catch (error) {
      value = skillDistributionError(scope, error);
    }

    metricsRegistry.incCounter(
      'port_daddy_skill_distribution_audits_total',
      'Skill distribution audits computed by the metrics plugin',
      { scope: value.scope, status: value.status },
    );
    skillCache = { ts: now, value };
    return value;
  }

  // ── /metrics/prom — Prometheus text ─────────────────────────────────────────
  fastify.get('/metrics/prom', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return metricsRegistry.toPrometheus() + skillDistributionPrometheus(loadSkillDistribution());
  });

  // ── /metrics/skills — skill freshness + cross-runtime distribution ──────────
  fastify.get('/metrics/skills', async () => {
    return loadSkillDistribution();
  });

  // ── /metrics/http/routes — JSON snapshot for the dashboard ──────────────────
  fastify.get('/metrics/http/routes', async () => {
    return metricsRegistry.snapshot();
  });

  // ── /metrics/http/outliers — recent slow requests ───────────────────────────
  fastify.get('/metrics/http/outliers', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const limit = parseBoundedInt(q.limit, 100, 500);
    return { outliers: metricsRegistry.outliers(limit) };
  });

  // ── /metrics/annotations — overlay context on time series ───────────────────
  /**
   * Returns events that map onto the charts page time axis: git commits
   * (deploy markers), version tags, recent pd notes (agent activity), and
   * session purposes (the "telos" — what an agent set out to do).
   *
   * ?since=N      seconds back (default 86400 = 24h, max 30 days)
   * ?limit=N      cap the response (default 200, max 1000)
   *
   * Git invocations are async (spawn-based) and cached for 30s so concurrent
   * dashboard polls share a single shell-out and never block the event loop.
   */
  fastify.get('/metrics/annotations', async (request: FastifyRequest) => {
    const q = request.query as Record<string, string>;
    const sinceSecs = parseBoundedInt(q.since, 86_400, 30 * 86_400);
    const sinceMs = Date.now() - sinceSecs * 1_000;
    const limit = parseBoundedInt(q.limit, 200, 1000);

    const events: AnnotationEvent[] = [];

    // ── Git commits / tags (async + cached) ──
    try {
      const gitEvents = await loadGitAnnotations(repoRoot, sinceSecs, sinceMs);
      events.push(...gitEvents);
    } catch {
      // already swallowed inside loadGitAnnotations; defensive double-catch
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

  // ── /metrics/http/now — debug stub: who is hitting us right now ─────────────
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
