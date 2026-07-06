/**
 * Cloud app telemetry — remote GitHub App / Cloudflare Worker activity.
 *
 * This records work that did not originate in the local spawner. Keep the
 * persistence separate so spend attribution stays honest, then project the
 * records into the same operator-visible agent/fleet reports as local work.
 */

import type { Database } from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import type { CostTracker } from './cost-tracker.js';
import type { Counters } from './counters.js';

export interface CloudAppTelemetryInput {
  id?: string;
  timestamp?: number;
  source?: string;
  provider?: string;
  appSlug?: string | null;
  deliveryId?: string | null;
  event?: string;
  action?: string | null;
  owner?: string | null;
  repo?: string | null;
  prNumber?: number | string | null;
  sha?: string | null;
  ship?: string | null;
  role?: string | null;
  status?: string;
  conclusion?: string | null;
  backend?: string | null;
  model?: string | null;
  durationMs?: number | string | null;
  inputTokens?: number | string | null;
  cachedInputTokens?: number | string | null;
  outputTokens?: number | string | null;
  costUsd?: number | string | null;
  costIsEstimate?: boolean | null;
  commentUrl?: string | null;
  checkRunId?: number | string | null;
  metadata?: Record<string, unknown> | null;
}

export interface CloudAppTelemetryEvent {
  id: string;
  ts: number;
  source: string;
  provider: string;
  appSlug: string | null;
  deliveryId: string | null;
  event: string;
  action: string | null;
  owner: string | null;
  repo: string | null;
  prNumber: number | null;
  sha: string | null;
  ship: string | null;
  role: string | null;
  status: string;
  conclusion: string | null;
  backend: string | null;
  model: string | null;
  durationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costIsEstimate: boolean | null;
  commentUrl: string | null;
  checkRunId: number | null;
  metadata: Record<string, unknown> | null;
}

export interface CloudAppTelemetrySummary {
  success: true;
  generatedAt: number;
  since: number;
  totals: {
    events: number;
    uniqueDeliveries: number;
    shipEvents: number;
    checkRunEvents: number;
    commentEvents: number;
    errorEvents: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    estimatedCostEvents: number;
    unknownCostEvents: number;
  };
  byRepo: Array<{
    owner: string | null;
    repo: string | null;
    events: number;
    pullRequests: number;
    costUsd: number;
    lastSeen: number;
  }>;
  byShip: Array<{
    ship: string;
    events: number;
    clean: number;
    findings: number;
    errors: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    lastSeen: number;
  }>;
  byBackend: Array<{
    backend: string;
    model: string | null;
    events: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostEvents: number;
  }>;
  recent: CloudAppTelemetryEvent[];
}

export interface CloudAppSyntheticAgent {
  id: string;
  name: string;
  pid: number;
  type: 'cloudflare';
  registeredAt: number;
  lastHeartbeat: number;
  timeSinceHeartbeat?: number;
  isActive: boolean;
  maxServices: number;
  maxLocks: number;
  metadata: Record<string, unknown>;
  agentCard: Record<string, unknown>;
  skills: string[];
  worktreeId: null;
  identity: string;
  identityProject: string;
  identityStack: 'cloudflare';
  identityContext: string;
  purpose: string;
  status: 'ready' | 'busy' | 'draining';
  readiness: Array<{ name: string; ok: boolean; reason?: string }>;
  isReady: boolean;
  progress: string;
  healthAssessment: {
    liveness: 'alive' | 'stale' | 'dead';
    graceRemaining: number;
  };
}

export interface CloudAppAgentListOptions {
  since?: number;
  limit?: number;
  activeOnly?: boolean;
  identityPrefix?: string | null;
  purpose?: string | null;
}

interface CloudAppTelemetryDeps {
  costTracker?: Pick<CostTracker, 'computeCost'>;
  counters?: Counters;
}

interface CloudAppTelemetryRow {
  id: string;
  ts: number;
  source: string;
  provider: string;
  app_slug: string | null;
  delivery_id: string | null;
  event: string;
  action: string | null;
  owner: string | null;
  repo: string | null;
  pr_number: number | null;
  sha: string | null;
  ship: string | null;
  role: string | null;
  status: string;
  conclusion: string | null;
  backend: string | null;
  model: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  cost_is_estimate: number | null;
  comment_url: string | null;
  check_run_id: number | null;
  metadata_json: string | null;
}

interface CloudAppAgentGroupRow {
  provider: string;
  app_slug: string | null;
  owner: string | null;
  repo: string | null;
  ship: string;
  role: string | null;
  events: number;
  pull_requests: number;
  cost_usd: number;
  estimated_cost_events: number;
  unknown_cost_events: number;
  first_seen: number;
  last_seen: number;
}

const REMOTE_AGENT_ACTIVE_WINDOW_MS = 4 * 60 * 60 * 1000;
const REMOTE_AGENT_STALE_WINDOW_MS = Math.round(REMOTE_AGENT_ACTIVE_WINDOW_MS * 0.6);

function cleanString(value: unknown, fallback: string, max = 240): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function nullableString(value: unknown, max = 400): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).slice(0, max);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function nullableMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return +Math.max(0, parsed).toFixed(6);
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function safeMetadata(value: Record<string, unknown> | null | undefined): string | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function eventId(input: CloudAppTelemetryInput): string {
  const explicit = nullableString(input.id, 120);
  if (explicit) return explicit;

  const stableParts = [
    input.source ?? 'github-app-receiver',
    input.deliveryId,
    input.event,
    input.action,
    input.owner,
    input.repo,
    input.prNumber,
    input.sha,
    input.ship,
    input.status,
    input.conclusion,
    input.checkRunId,
    input.commentUrl,
  ].map((part) => part ?? null);

  if (stableParts.some((part) => part !== null)) {
    return createHash('sha256').update(JSON.stringify(stableParts)).digest('hex').slice(0, 32);
  }
  return randomBytes(16).toString('hex');
}

function idPart(value: string | null | undefined, fallback: string, max = 32): string {
  const raw = (value || fallback).trim().toLowerCase();
  const cleaned = raw
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-:.]+|[-:.]+$/g, '');
  return (cleaned || fallback).slice(0, max);
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value.startsWith(pattern);
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}`).test(value);
}

function toEvent(row: CloudAppTelemetryRow): CloudAppTelemetryEvent {
  return {
    id: row.id,
    ts: row.ts,
    source: row.source,
    provider: row.provider,
    appSlug: row.app_slug,
    deliveryId: row.delivery_id,
    event: row.event,
    action: row.action,
    owner: row.owner,
    repo: row.repo,
    prNumber: row.pr_number,
    sha: row.sha,
    ship: row.ship,
    role: row.role,
    status: row.status,
    conclusion: row.conclusion,
    backend: row.backend,
    model: row.model,
    durationMs: row.duration_ms,
    inputTokens: row.input_tokens,
    cachedInputTokens: row.cached_input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    costIsEstimate: row.cost_is_estimate == null ? null : row.cost_is_estimate === 1,
    commentUrl: row.comment_url,
    checkRunId: row.check_run_id,
    metadata: parseMetadata(row.metadata_json),
  };
}

export function createCloudAppTelemetry(db: Database, deps: CloudAppTelemetryDeps = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_app_telemetry_events (
      id                  TEXT PRIMARY KEY,
      ts                  INTEGER NOT NULL,
      source              TEXT NOT NULL,
      provider            TEXT NOT NULL,
      app_slug            TEXT,
      delivery_id         TEXT,
      event               TEXT NOT NULL,
      action              TEXT,
      owner               TEXT,
      repo                TEXT,
      pr_number           INTEGER,
      sha                 TEXT,
      ship                TEXT,
      role                TEXT,
      status              TEXT NOT NULL,
      conclusion          TEXT,
      backend             TEXT,
      model               TEXT,
      duration_ms         INTEGER,
      input_tokens        INTEGER,
      cached_input_tokens INTEGER,
      output_tokens       INTEGER,
      cost_usd            REAL,
      cost_is_estimate    INTEGER,
      comment_url         TEXT,
      check_run_id        INTEGER,
      metadata_json       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cate_ts ON cloud_app_telemetry_events(ts);
    CREATE INDEX IF NOT EXISTS idx_cate_repo_pr_ts ON cloud_app_telemetry_events(owner, repo, pr_number, ts);
    CREATE INDEX IF NOT EXISTS idx_cate_ship_ts ON cloud_app_telemetry_events(ship, ts);
    CREATE INDEX IF NOT EXISTS idx_cate_delivery ON cloud_app_telemetry_events(delivery_id);
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO cloud_app_telemetry_events (
      id, ts, source, provider, app_slug, delivery_id, event, action, owner, repo,
      pr_number, sha, ship, role, status, conclusion, backend, model, duration_ms,
      input_tokens, cached_input_tokens, output_tokens, cost_usd, cost_is_estimate,
      comment_url, check_run_id, metadata_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      ts = excluded.ts,
      source = excluded.source,
      provider = excluded.provider,
      app_slug = excluded.app_slug,
      delivery_id = excluded.delivery_id,
      event = excluded.event,
      action = excluded.action,
      owner = excluded.owner,
      repo = excluded.repo,
      pr_number = excluded.pr_number,
      sha = excluded.sha,
      ship = excluded.ship,
      role = excluded.role,
      status = excluded.status,
      conclusion = excluded.conclusion,
      backend = excluded.backend,
      model = excluded.model,
      duration_ms = excluded.duration_ms,
      input_tokens = excluded.input_tokens,
      cached_input_tokens = excluded.cached_input_tokens,
      output_tokens = excluded.output_tokens,
      cost_usd = excluded.cost_usd,
      cost_is_estimate = excluded.cost_is_estimate,
      comment_url = excluded.comment_url,
      check_run_id = excluded.check_run_id,
      metadata_json = excluded.metadata_json
  `);

  const getStmt = db.prepare(`SELECT * FROM cloud_app_telemetry_events WHERE id = ?`);
  const latestAgentEventStmt = db.prepare(`
    SELECT * FROM cloud_app_telemetry_events
    WHERE ts >= ?
      AND provider = ?
      AND COALESCE(app_slug, '') = ?
      AND COALESCE(owner, '') = ?
      AND COALESCE(repo, '') = ?
      AND ship = ?
    ORDER BY ts DESC
    LIMIT 1
  `);

  function deriveCost(input: {
    backend: string | null;
    model: string | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    costIsEstimate: boolean | null;
  }): { costUsd: number | null; costIsEstimate: boolean | null } {
    if (input.costUsd !== null) {
      return { costUsd: input.costUsd, costIsEstimate: input.costIsEstimate ?? false };
    }
    if (!deps.costTracker || !input.backend || !input.model) {
      return { costUsd: null, costIsEstimate: null };
    }
    if (input.inputTokens === null && input.outputTokens === null && input.cachedInputTokens === null) {
      return { costUsd: null, costIsEstimate: null };
    }
    const computed = deps.costTracker.computeCost(
      input.backend,
      input.model,
      input.inputTokens ?? undefined,
      input.outputTokens ?? undefined,
      input.cachedInputTokens ?? undefined,
    );
    return { costUsd: computed.costUsd, costIsEstimate: computed.isEstimate };
  }

  function record(input: CloudAppTelemetryInput): CloudAppTelemetryEvent | null {
    try {
      const id = eventId(input);
      const ts = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
      const source = cleanString(input.source, 'github-app-receiver', 80);
      const provider = cleanString(input.provider, 'github', 80);
      const backend = nullableString(input.backend, 80);
      const model = nullableString(input.model, 160);
      const inputTokens = nullableInt(input.inputTokens);
      const cachedInputTokens = nullableInt(input.cachedInputTokens);
      const outputTokens = nullableInt(input.outputTokens);
      const explicitCost = nullableMoney(input.costUsd);
      const derived = deriveCost({
        backend,
        model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costUsd: explicitCost,
        costIsEstimate: typeof input.costIsEstimate === 'boolean' ? input.costIsEstimate : null,
      });

      upsertStmt.run(
        id,
        ts,
        source,
        provider,
        nullableString(input.appSlug, 120),
        nullableString(input.deliveryId, 160),
        cleanString(input.event, 'unknown', 120),
        nullableString(input.action, 120),
        nullableString(input.owner, 120),
        nullableString(input.repo, 160),
        nullableInt(input.prNumber),
        nullableString(input.sha, 120),
        nullableString(input.ship, 120),
        nullableString(input.role, 200),
        cleanString(input.status, 'observed', 80),
        nullableString(input.conclusion, 80),
        backend,
        model,
        nullableInt(input.durationMs),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        derived.costUsd,
        derived.costIsEstimate == null ? null : derived.costIsEstimate ? 1 : 0,
        nullableString(input.commentUrl, 500),
        nullableInt(input.checkRunId),
        safeMetadata(input.metadata),
      );

      deps.counters?.bump('cloud_app.telemetry.recorded', {
        source,
        provider,
        backend: backend ?? 'unknown',
        ship: nullableString(input.ship, 120) ?? 'none',
        status: cleanString(input.status, 'observed', 80),
      });

      const row = getStmt.get(id) as CloudAppTelemetryRow | undefined;
      return row ? toEvent(row) : null;
    } catch {
      return null;
    }
  }

  function recent(limit = 50, since = Date.now() - 86_400_000): CloudAppTelemetryEvent[] {
    const capped = Math.max(0, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, 500));
    const rows = db.prepare(`
      SELECT * FROM cloud_app_telemetry_events
      WHERE ts >= ?
      ORDER BY ts DESC
      LIMIT ?
    `).all(since, capped) as CloudAppTelemetryRow[];
    return rows.map(toEvent);
  }

  function summary(options: { since?: number; limit?: number } = {}): CloudAppTelemetrySummary {
    const since = options.since ?? Date.now() - 86_400_000;
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS events,
        COUNT(DISTINCT COALESCE(delivery_id, id)) AS unique_deliveries,
        SUM(CASE WHEN ship IS NOT NULL THEN 1 ELSE 0 END) AS ship_events,
        SUM(CASE WHEN check_run_id IS NOT NULL OR status LIKE 'check_%' THEN 1 ELSE 0 END) AS check_run_events,
        SUM(CASE WHEN comment_url IS NOT NULL OR ship IS NOT NULL THEN 1 ELSE 0 END) AS comment_events,
        SUM(CASE WHEN status IN ('error', 'failed') OR conclusion IN ('failure', 'timed_out', 'cancelled') THEN 1 ELSE 0 END) AS error_events,
        COALESCE(SUM(cost_usd), 0) AS cost_usd,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
        SUM(CASE WHEN cost_is_estimate = 1 THEN 1 ELSE 0 END) AS estimated_cost_events,
        SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_events
      FROM cloud_app_telemetry_events
      WHERE ts >= ?
    `).get(since) as {
      events: number;
      unique_deliveries: number;
      ship_events: number;
      check_run_events: number;
      comment_events: number;
      error_events: number;
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      cached_input_tokens: number;
      estimated_cost_events: number;
      unknown_cost_events: number;
    };

    const byRepo = db.prepare(`
      SELECT owner, repo, COUNT(*) AS events, COUNT(DISTINCT pr_number) AS pull_requests,
             COALESCE(SUM(cost_usd), 0) AS cost_usd, MAX(ts) AS last_seen
      FROM cloud_app_telemetry_events
      WHERE ts >= ?
      GROUP BY owner, repo
      ORDER BY events DESC, last_seen DESC
      LIMIT ?
    `).all(since, limit) as Array<{
      owner: string | null;
      repo: string | null;
      events: number;
      pull_requests: number;
      cost_usd: number;
      last_seen: number;
    }>;

    const byShip = db.prepare(`
      SELECT ship, COUNT(*) AS events,
             SUM(CASE WHEN status = 'clean' THEN 1 ELSE 0 END) AS clean,
             SUM(CASE WHEN status = 'findings' THEN 1 ELSE 0 END) AS findings,
             SUM(CASE WHEN status IN ('error', 'failed') THEN 1 ELSE 0 END) AS errors,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             COALESCE(SUM(input_tokens), 0) AS input_tokens,
             COALESCE(SUM(output_tokens), 0) AS output_tokens,
             MAX(ts) AS last_seen
      FROM cloud_app_telemetry_events
      WHERE ts >= ? AND ship IS NOT NULL
      GROUP BY ship
      ORDER BY events DESC, last_seen DESC
      LIMIT ?
    `).all(since, limit) as Array<{
      ship: string;
      events: number;
      clean: number;
      findings: number;
      errors: number;
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      last_seen: number;
    }>;

    const byBackend = db.prepare(`
      SELECT COALESCE(backend, 'unknown') AS backend, model,
             COUNT(*) AS events,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             COALESCE(SUM(input_tokens), 0) AS input_tokens,
             COALESCE(SUM(output_tokens), 0) AS output_tokens,
             SUM(CASE WHEN cost_is_estimate = 1 THEN 1 ELSE 0 END) AS estimated_cost_events
      FROM cloud_app_telemetry_events
      WHERE ts >= ?
      GROUP BY backend, model
      ORDER BY cost_usd DESC, events DESC
      LIMIT ?
    `).all(since, limit) as Array<{
      backend: string;
      model: string | null;
      events: number;
      cost_usd: number;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_events: number;
    }>;

    return {
      success: true,
      generatedAt: Date.now(),
      since,
      totals: {
        events: totals.events,
        uniqueDeliveries: totals.unique_deliveries,
        shipEvents: totals.ship_events ?? 0,
        checkRunEvents: totals.check_run_events ?? 0,
        commentEvents: totals.comment_events ?? 0,
        errorEvents: totals.error_events ?? 0,
        costUsd: +Number(totals.cost_usd ?? 0).toFixed(6),
        inputTokens: totals.input_tokens ?? 0,
        outputTokens: totals.output_tokens ?? 0,
        cachedInputTokens: totals.cached_input_tokens ?? 0,
        totalTokens: (totals.input_tokens ?? 0) + (totals.output_tokens ?? 0),
        estimatedCostEvents: totals.estimated_cost_events ?? 0,
        unknownCostEvents: totals.unknown_cost_events ?? 0,
      },
      byRepo: byRepo.map((row) => ({
        owner: row.owner,
        repo: row.repo,
        events: row.events,
        pullRequests: row.pull_requests,
        costUsd: +Number(row.cost_usd ?? 0).toFixed(6),
        lastSeen: row.last_seen,
      })),
      byShip: byShip.map((row) => ({
        ship: row.ship,
        events: row.events,
        clean: row.clean ?? 0,
        findings: row.findings ?? 0,
        errors: row.errors ?? 0,
        costUsd: +Number(row.cost_usd ?? 0).toFixed(6),
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        lastSeen: row.last_seen,
      })),
      byBackend: byBackend.map((row) => ({
        backend: row.backend,
        model: row.model,
        events: row.events,
        costUsd: +Number(row.cost_usd ?? 0).toFixed(6),
        inputTokens: row.input_tokens ?? 0,
        outputTokens: row.output_tokens ?? 0,
        estimatedCostEvents: row.estimated_cost_events ?? 0,
      })),
      recent: recent(limit, since),
    };
  }

  function latestEventForGroup(since: number, row: CloudAppAgentGroupRow): CloudAppTelemetryEvent | null {
    const latest = latestAgentEventStmt.get(
      since,
      row.provider,
      row.app_slug ?? '',
      row.owner ?? '',
      row.repo ?? '',
      row.ship,
    ) as CloudAppTelemetryRow | undefined;
    return latest ? toEvent(latest) : null;
  }

  function agentIdFor(row: CloudAppAgentGroupRow): string {
    const repoPart = idPart([row.owner, row.repo].filter(Boolean).join('.') || null, 'unknown-repo', 38);
    const shipPart = idPart(row.ship, 'ship', 24);
    const hash = createHash('sha256')
      .update(JSON.stringify([row.provider, row.app_slug, row.owner, row.repo, row.ship]))
      .digest('hex')
      .slice(0, 8);
    return `cloudflare:${repoPart}:${shipPart}:${hash}`;
  }

  function syntheticAgent(row: CloudAppAgentGroupRow, latest: CloudAppTelemetryEvent | null, now: number): CloudAppSyntheticAgent {
    const ageMs = Math.max(0, now - row.last_seen);
    const liveness = ageMs >= REMOTE_AGENT_ACTIVE_WINDOW_MS
      ? 'dead'
      : ageMs >= REMOTE_AGENT_STALE_WINDOW_MS
        ? 'stale'
        : 'alive';
    const failed = latest?.status === 'error' ||
      latest?.status === 'failed' ||
      latest?.conclusion === 'failure' ||
      latest?.conclusion === 'timed_out' ||
      latest?.conclusion === 'cancelled';
    const status = failed ? 'draining' : 'ready';
    const repoLabel = [row.owner, row.repo].filter(Boolean).join('/') || 'unknown repo';
    const identityProject = idPart(row.repo ?? row.owner, 'remote', 48);
    const identityContext = idPart(row.ship, 'ship', 48);
    const displayName = row.ship.startsWith('pd-') ? row.ship : `pd-${row.ship}`;
    const costUsd = +Number(row.cost_usd ?? 0).toFixed(6);
    const latestPr = latest?.prNumber ? `#${latest.prNumber}` : 'PR fleet';
    const latestBackend = latest?.backend ?? 'unknown backend';
    const latestModel = latest?.model ? `/${latest.model}` : '';

    return {
      id: agentIdFor(row),
      name: displayName,
      pid: 0,
      type: 'cloudflare',
      registeredAt: row.first_seen,
      lastHeartbeat: row.last_seen,
      timeSinceHeartbeat: ageMs,
      isActive: liveness !== 'dead',
      maxServices: 0,
      maxLocks: 0,
      metadata: {
        origin: 'remote',
        remote: true,
        telemetrySource: 'cloud-app',
        provider: row.provider,
        appSlug: row.app_slug,
        owner: row.owner,
        repo: row.repo,
        ship: row.ship,
        role: row.role,
        events: row.events,
        pullRequests: row.pull_requests,
        costUsd,
        estimatedCostEvents: row.estimated_cost_events ?? 0,
        unknownCostEvents: row.unknown_cost_events ?? 0,
        latestEventId: latest?.id ?? null,
        latestDeliveryId: latest?.deliveryId ?? null,
        latestPrNumber: latest?.prNumber ?? null,
        latestSha: latest?.sha ?? null,
        latestStatus: latest?.status ?? null,
        latestConclusion: latest?.conclusion ?? null,
        latestBackend: latest?.backend ?? null,
        latestModel: latest?.model ?? null,
        latestCommentUrl: latest?.commentUrl ?? null,
        latestCheckRunId: latest?.checkRunId ?? null,
      },
      agentCard: {
        schemaVersion: 'pd.agent-card.v1',
        name: displayName,
        runtime: 'cloudflare-worker',
        provider: row.provider,
        appSlug: row.app_slug,
        repo: repoLabel,
        ship: row.ship,
      },
      skills: ['remote-telemetry', 'github-pr-fleet'],
      worktreeId: null,
      identity: `${identityProject}:cloudflare:${identityContext}`,
      identityProject,
      identityStack: 'cloudflare',
      identityContext,
      purpose: `Remote ${row.role || row.ship} for ${repoLabel} PR fleet`,
      status,
      readiness: [
        { name: 'remote telemetry', ok: true },
        {
          name: 'latest run',
          ok: !failed,
          reason: latest ? `${latest.status}${latest.conclusion ? `/${latest.conclusion}` : ''}` : 'no recent event',
        },
      ],
      isReady: !failed,
      progress: `${latestPr} ${latest?.status ?? 'observed'} via ${latestBackend}${latestModel}; ${row.events} event(s), $${costUsd.toFixed(6)}`,
      healthAssessment: {
        liveness,
        graceRemaining: Math.max(0, REMOTE_AGENT_ACTIVE_WINDOW_MS - ageMs),
      },
    };
  }

  function listAgents(options: CloudAppAgentListOptions = {}): CloudAppSyntheticAgent[] {
    const now = Date.now();
    const since = options.since ?? now - 86_400_000;
    const limit = Math.max(1, Math.min(options.limit ?? 200, 500));
    const rows = db.prepare(`
      SELECT provider, app_slug, owner, repo, ship,
             MAX(role) AS role,
             COUNT(*) AS events,
             COUNT(DISTINCT pr_number) AS pull_requests,
             COALESCE(SUM(cost_usd), 0) AS cost_usd,
             SUM(CASE WHEN cost_is_estimate = 1 THEN 1 ELSE 0 END) AS estimated_cost_events,
             SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_events,
             MIN(ts) AS first_seen,
             MAX(ts) AS last_seen
      FROM cloud_app_telemetry_events
      WHERE ts >= ? AND ship IS NOT NULL
      GROUP BY provider, COALESCE(app_slug, ''), COALESCE(owner, ''), COALESCE(repo, ''), ship
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(since, limit) as CloudAppAgentGroupRow[];

    return rows
      .map((row) => syntheticAgent(row, latestEventForGroup(since, row), now))
      .filter((agent) => !options.activeOnly || agent.isActive)
      .filter((agent) => !options.identityPrefix || wildcardMatch(agent.identity, options.identityPrefix))
      .filter((agent) => {
        if (!options.purpose) return true;
        const purpose = agent.purpose.toLowerCase();
        const pattern = options.purpose.toLowerCase();
        return pattern.includes('*') ? wildcardMatch(purpose, pattern) : purpose.includes(pattern);
      });
  }

  function getAgent(agentId: string, options: { since?: number } = {}): CloudAppSyntheticAgent | null {
    return listAgents({ since: options.since, limit: 500 }).find((agent) => agent.id === agentId) ?? null;
  }

  return { record, recent, summary, agents: listAgents, getAgent };
}

export type CloudAppTelemetry = ReturnType<typeof createCloudAppTelemetry>;
