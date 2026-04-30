/**
 * Usage telemetry - product usage counters plus append-only trace events.
 *
 * This is intentionally local-first. Port Daddy needs to understand how its own
 * coordination surfaces are used without exporting operator behavior anywhere.
 */

import type { Database } from 'better-sqlite3';
import type { Counters } from './counters.js';

export interface UsageBuildMeta {
  version: string;
  codeHash: string;
  buildDate: string;
}

export interface UsageTelemetryRecordInput {
  timestamp?: number;
  surface: string;
  kind: string;
  name: string;
  category?: string | null;
  agentId?: string | null;
  agentType?: string | null;
  agentModel?: string | null;
  backend?: string | null;
  model?: string | null;
  project?: string | null;
  projectDir?: string | null;
  route?: string | null;
  method?: string | null;
  status?: string | number | null;
  durationMs?: number | null;
  workScope?: 'port_daddy_call' | 'agent_work' | 'other_work' | string | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  turns?: number | null;
  toolCalls?: number | null;
  costUsd?: number | null;
  costCurrency?: string | null;
  costIsEstimate?: boolean | null;
  context?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  version?: string | null;
  codeHash?: string | null;
  buildDate?: string | null;
  cwd?: string | null;
  userAgent?: string | null;
}

interface UsageEventRow {
  id: number;
  timestamp: number;
  surface: string;
  kind: string;
  name: string;
  category: string | null;
  agent_id: string | null;
  agent_type: string | null;
  agent_model: string | null;
  backend: string | null;
  model: string | null;
  project: string | null;
  project_dir: string | null;
  route: string | null;
  method: string | null;
  status: string | null;
  duration_ms: number | null;
  work_scope: string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  turns: number | null;
  tool_calls: number | null;
  cost_usd: number | null;
  cost_currency: string | null;
  cost_is_estimate: number | null;
  context_json: string | null;
  metadata_json: string | null;
  version: string | null;
  code_hash: string | null;
  build_date: string | null;
  cwd: string | null;
  user_agent: string | null;
}

export interface UsageBreakdownRow {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

export interface UsageNameRow {
  surface: string;
  kind: string;
  category: string;
  name: string;
  count: number;
  avgDurationMs: number | null;
  lastSeen: number;
}

export interface UsageAgentModelRow {
  agentType: string;
  agentModel: string;
  backend: string;
  model: string;
  surface: string;
  count: number;
  lastSeen: number;
}

export interface UsageCapabilityRow {
  category: string;
  count: number;
  surfaces: Record<string, number>;
  models: Array<{ label: string; count: number }>;
}

export interface UsageAgentCapabilityRow {
  agentType: string;
  agentModel: string;
  backend: string;
  model: string;
  category: string;
  count: number;
}

export interface UsageCostScopeRow {
  scope: string;
  events: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turns: number;
  toolCalls: number;
  costUsd: number;
  estimatedCostEvents: number;
}

export interface UsageRecentEvent {
  id: number;
  timestamp: number;
  surface: string;
  kind: string;
  name: string;
  category: string;
  agentId: string | null;
  agentType: string | null;
  agentModel: string | null;
  backend: string | null;
  model: string | null;
  project: string | null;
  route: string | null;
  method: string | null;
  status: string | null;
  durationMs: number | null;
  workScope: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  turns: number | null;
  toolCalls: number | null;
  costUsd: number | null;
  costCurrency: string | null;
  costIsEstimate: boolean | null;
  version: string | null;
  codeHash: string | null;
  buildDate: string | null;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface UsageTelemetrySummary {
  success: true;
  generatedAt: number;
  since: number;
  periodMs: number;
  build: UsageBuildMeta;
  totals: {
    events: number;
    uniqueAgents: number;
    uniqueProjects: number;
    uniqueModels: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    turns: number;
    toolCalls: number;
    costUsd: number;
  };
  costByScope: UsageCostScopeRow[];
  bySurface: UsageBreakdownRow[];
  byKind: UsageBreakdownRow[];
  byCategory: UsageBreakdownRow[];
  topNames: UsageNameRow[];
  agentModels: UsageAgentModelRow[];
  capabilities: UsageCapabilityRow[];
  agentCapabilityMatrix: UsageAgentCapabilityRow[];
  unusedCapabilities: string[];
  recent: UsageRecentEvent[];
}

const KNOWN_CAPABILITIES = [
  'agents',
  'activity',
  'budget',
  'channels',
  'fleet',
  'locks',
  'memory',
  'messages',
  'pheromones',
  'ports',
  'projects',
  'resources',
  'salvage',
  'sessions',
  'sorties',
  'spawn',
  'tuples',
  'usage',
  'yaml',
] as const;

const SURFACE_ALLOWLIST = new Set(['cli', 'sdk', 'mcp', 'ui', 'daemon', 'fleetbar', 'website', 'unknown']);
const KIND_ALLOWLIST = new Set(['function_call', 'tool_call', 'command', 'view', 'interaction', 'engagement', 'api_call', 'route', 'agent_work', 'event']);

function cleanString(value: unknown, fallback = 'unknown', max = 240): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, max);
}

function nullableString(value: unknown, max = 240): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function nullableMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return +Math.max(0, parsed).toFixed(6);
}

function safeJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value || typeof value !== 'object') return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: true });
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
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

function normalizeSurface(value: string): string {
  const surface = cleanString(value, 'unknown', 40).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return SURFACE_ALLOWLIST.has(surface) ? surface : surface || 'unknown';
}

function normalizeKind(value: string): string {
  const kind = cleanString(value, 'event', 60).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return KIND_ALLOWLIST.has(kind) ? kind : kind || 'event';
}

function metricSafe(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'unknown';
}

function normalizeWorkScope(value: unknown, kind: string): string {
  const scope = nullableString(value, 80);
  if (scope) return metricSafe(scope);
  return kind === 'agent_work' ? 'agent_work' : 'port_daddy_call';
}

function normalizeRoute(route: string | null | undefined): string {
  if (!route) return '';
  const withoutQuery = route.split('?')[0] ?? route;
  return withoutQuery
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id')
    .replace(/\/agent-[^/]+(?=\/|$)/g, '/:agent')
    .slice(0, 180);
}

export function classifyUsageCategory(input: Pick<UsageTelemetryRecordInput, 'category' | 'name' | 'route' | 'metadata'>): string {
  const explicit = nullableString(input.category, 80);
  if (explicit) return metricSafe(explicit);

  const metadataCategory = input.metadata && typeof input.metadata.category === 'string'
    ? input.metadata.category
    : null;
  if (metadataCategory) return metricSafe(metadataCategory);

  const haystack = [
    input.name,
    input.route,
    input.metadata && typeof input.metadata.path === 'string' ? input.metadata.path : null,
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('pheromone') || haystack.includes('file_heat') || haystack.includes('/look')) return 'pheromones';
  if (haystack.includes('tuple') || haystack.includes('/tuples')) return 'tuples';
  if (haystack.includes('/locks') || haystack.includes('lock')) return 'locks';
  if (haystack.includes('/msg') || haystack.includes('channel') || haystack.includes('publish') || haystack.includes('tube')) return 'channels';
  if (haystack.includes('/agents') || haystack.includes('agent')) return 'agents';
  if (haystack.includes('/sessions') || haystack.includes('session') || haystack.includes('note')) return 'sessions';
  if (haystack.includes('/spawn') || haystack.includes('spawn')) return 'spawn';
  if (haystack.includes('/fleet') || haystack.includes('fleet')) return 'fleet';
  if (haystack.includes('/resources') || haystack.includes('resource')) return 'resources';
  if (haystack.includes('/activity') || haystack.includes('activity')) return 'activity';
  if (haystack.includes('/memory') || haystack.includes('memory')) return 'memory';
  if (haystack.includes('/sorties') || haystack.includes('sortie')) return 'sorties';
  if (haystack.includes('/projects') || haystack.includes('project')) return 'projects';
  if (haystack.includes('/budget') || haystack.includes('wallet') || haystack.includes('bond')) return 'budget';
  if (haystack.includes('/usage') || haystack.includes('usage')) return 'usage';
  if (haystack.includes('yaml') || haystack.includes('config')) return 'yaml';
  if (haystack.includes('/claim') || haystack.includes('/release') || haystack.includes('/services') || haystack.includes('port')) return 'ports';
  if (haystack.includes('salvage') || haystack.includes('resurrection')) return 'salvage';
  return 'other';
}

function pct(count: number, total: number): number {
  return total > 0 ? +((count / total) * 100).toFixed(1) : 0;
}

function toBreakdown(rows: Array<{ key: string | null; count: number }>, total: number): UsageBreakdownRow[] {
  return rows.map((row) => {
    const key = row.key || 'unknown';
    return { key, label: key, count: row.count, percentage: pct(row.count, total) };
  });
}

function labelModel(row: { agent_type?: string | null; agent_model?: string | null; backend?: string | null; model?: string | null }): string {
  return [
    row.agent_type || null,
    row.agent_model || row.model || null,
    row.backend || null,
  ].filter(Boolean).join(' / ') || 'unknown';
}

export function createUsageTelemetry(db: Database, build: UsageBuildMeta, opts: { counters?: Counters } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     INTEGER NOT NULL,
      surface       TEXT NOT NULL,
      kind          TEXT NOT NULL,
      name          TEXT NOT NULL,
      category      TEXT,
      agent_id      TEXT,
      agent_type    TEXT,
      agent_model   TEXT,
      backend       TEXT,
      model         TEXT,
      project       TEXT,
      project_dir   TEXT,
      route         TEXT,
      method        TEXT,
      status        TEXT,
      duration_ms   INTEGER,
      work_scope    TEXT,
      input_tokens  INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens  INTEGER,
      turns         INTEGER,
      tool_calls    INTEGER,
      cost_usd      REAL,
      cost_currency TEXT,
      cost_is_estimate INTEGER,
      context_json  TEXT,
      metadata_json TEXT,
      version       TEXT,
      code_hash     TEXT,
      build_date    TEXT,
      cwd           TEXT,
      user_agent    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_time ON usage_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_surface_time ON usage_events(surface, timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_kind_time ON usage_events(kind, timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_category_time ON usage_events(category, timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_agent_model_time ON usage_events(agent_type, agent_model, backend, model, timestamp);
    CREATE INDEX IF NOT EXISTS idx_usage_events_scope_time ON usage_events(work_scope, timestamp);
  `);

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(usage_events)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  const migrations: Record<string, string> = {
    work_scope: 'ALTER TABLE usage_events ADD COLUMN work_scope TEXT;',
    input_tokens: 'ALTER TABLE usage_events ADD COLUMN input_tokens INTEGER;',
    cached_input_tokens: 'ALTER TABLE usage_events ADD COLUMN cached_input_tokens INTEGER;',
    output_tokens: 'ALTER TABLE usage_events ADD COLUMN output_tokens INTEGER;',
    total_tokens: 'ALTER TABLE usage_events ADD COLUMN total_tokens INTEGER;',
    turns: 'ALTER TABLE usage_events ADD COLUMN turns INTEGER;',
    tool_calls: 'ALTER TABLE usage_events ADD COLUMN tool_calls INTEGER;',
    cost_usd: 'ALTER TABLE usage_events ADD COLUMN cost_usd REAL;',
    cost_currency: 'ALTER TABLE usage_events ADD COLUMN cost_currency TEXT;',
    cost_is_estimate: 'ALTER TABLE usage_events ADD COLUMN cost_is_estimate INTEGER;',
  };
  for (const [column, sql] of Object.entries(migrations)) {
    if (!existingColumns.has(column)) db.exec(sql);
  }

  const insertStmt = db.prepare(`
    INSERT INTO usage_events (
      timestamp, surface, kind, name, category, agent_id, agent_type, agent_model,
      backend, model, project, project_dir, route, method, status, duration_ms,
      work_scope, input_tokens, cached_input_tokens, output_tokens, total_tokens,
      turns, tool_calls, cost_usd, cost_currency, cost_is_estimate,
      context_json, metadata_json, version, code_hash, build_date, cwd, user_agent
    ) VALUES (
      @timestamp, @surface, @kind, @name, @category, @agent_id, @agent_type, @agent_model,
      @backend, @model, @project, @project_dir, @route, @method, @status, @duration_ms,
      @work_scope, @input_tokens, @cached_input_tokens, @output_tokens, @total_tokens,
      @turns, @tool_calls, @cost_usd, @cost_currency, @cost_is_estimate,
      @context_json, @metadata_json, @version, @code_hash, @build_date, @cwd, @user_agent
    )
  `);

  function record(input: UsageTelemetryRecordInput): { success: true; id: number } {
    const surface = normalizeSurface(input.surface);
    const kind = normalizeKind(input.kind);
    const route = normalizeRoute(nullableString(input.route, 300));
    const name = cleanString(input.name || route || `${surface}.${kind}`, `${surface}.${kind}`, 180);
    const category = classifyUsageCategory({ ...input, name, route });
    const timestamp = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
    const durationMs = typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
      ? Math.max(0, Math.round(input.durationMs))
      : null;
    const inputTokens = nullableCount(input.inputTokens);
    const cachedInputTokens = nullableCount(input.cachedInputTokens);
    const outputTokens = nullableCount(input.outputTokens);
    const totalTokens = nullableCount(input.totalTokens) ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || null);

    const row = {
      timestamp,
      surface,
      kind,
      name,
      category,
      agent_id: nullableString(input.agentId),
      agent_type: nullableString(input.agentType, 80),
      agent_model: nullableString(input.agentModel, 120),
      backend: nullableString(input.backend, 80),
      model: nullableString(input.model, 120),
      project: nullableString(input.project, 160),
      project_dir: nullableString(input.projectDir, 400),
      route: route || null,
      method: nullableString(input.method, 20)?.toUpperCase() ?? null,
      status: nullableString(input.status, 80),
      duration_ms: durationMs,
      work_scope: normalizeWorkScope(input.workScope, kind),
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      turns: nullableCount(input.turns),
      tool_calls: nullableCount(input.toolCalls),
      cost_usd: nullableMoney(input.costUsd),
      cost_currency: nullableString(input.costCurrency, 16) ?? (input.costUsd != null ? 'USD' : null),
      cost_is_estimate: typeof input.costIsEstimate === 'boolean' ? (input.costIsEstimate ? 1 : 0) : null,
      context_json: safeJson(input.context),
      metadata_json: safeJson(input.metadata),
      version: nullableString(input.version, 80) ?? build.version,
      code_hash: nullableString(input.codeHash, 80) ?? build.codeHash,
      build_date: nullableString(input.buildDate, 80) ?? build.buildDate,
      cwd: nullableString(input.cwd, 400),
      user_agent: nullableString(input.userAgent, 300),
    };

    const info = insertStmt.run(row);
    opts.counters?.bump(`usage.${surface}.${kind}`, {
      category,
      surface,
      kind,
      name: metricSafe(name),
      scope: metricSafe(row.work_scope ?? 'port_daddy_call'),
      agent_type: metricSafe(row.agent_type ?? 'unknown'),
      backend: metricSafe(row.backend ?? 'unknown'),
      model: metricSafe(row.agent_model ?? row.model ?? 'unknown'),
      status: metricSafe(row.status ?? 'unknown'),
    });

    return { success: true, id: Number(info.lastInsertRowid) };
  }

  function recent(limit = 80, since = Date.now() - 7 * 86_400_000): UsageRecentEvent[] {
    const capped = Math.max(1, Math.min(Math.floor(limit), 300));
    const rows = db.prepare(`
      SELECT * FROM usage_events
      WHERE timestamp >= ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(since, capped) as UsageEventRow[];

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      surface: row.surface,
      kind: row.kind,
      name: row.name,
      category: row.category || 'other',
      agentId: row.agent_id,
      agentType: row.agent_type,
      agentModel: row.agent_model,
      backend: row.backend,
      model: row.model,
      project: row.project,
      route: row.route,
      method: row.method,
      status: row.status,
      durationMs: row.duration_ms,
      workScope: row.work_scope,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.total_tokens,
      turns: row.turns,
      toolCalls: row.tool_calls,
      costUsd: row.cost_usd,
      costCurrency: row.cost_currency,
      costIsEstimate: row.cost_is_estimate == null ? null : row.cost_is_estimate === 1,
      version: row.version,
      codeHash: row.code_hash,
      buildDate: row.build_date,
      context: parseJsonObject(row.context_json),
      metadata: parseJsonObject(row.metadata_json),
    }));
  }

  function summary(options: { since?: number; limit?: number } = {}): UsageTelemetrySummary {
    const since = options.since ?? Date.now() - 7 * 86_400_000;
    const limit = Math.max(5, Math.min(options.limit ?? 80, 300));
    const generatedAt = Date.now();
    const total = (db.prepare(`
      SELECT COUNT(*) as count,
        COUNT(DISTINCT COALESCE(agent_id, agent_type, '')) as uniqueAgents,
        COUNT(DISTINCT COALESCE(project_dir, project, '')) as uniqueProjects,
        COUNT(DISTINCT COALESCE(agent_model, model, backend, '')) as uniqueModels,
        COALESCE(SUM(input_tokens), 0) as inputTokens,
        COALESCE(SUM(cached_input_tokens), 0) as cachedInputTokens,
        COALESCE(SUM(output_tokens), 0) as outputTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(turns), 0) as turns,
        COALESCE(SUM(tool_calls), 0) as toolCalls,
        COALESCE(SUM(cost_usd), 0) as costUsd
      FROM usage_events
      WHERE timestamp >= ?
    `).get(since) as {
      count: number;
      uniqueAgents: number;
      uniqueProjects: number;
      uniqueModels: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      totalTokens: number;
      turns: number;
      toolCalls: number;
      costUsd: number;
    }) ?? {
      count: 0,
      uniqueAgents: 0,
      uniqueProjects: 0,
      uniqueModels: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turns: 0,
      toolCalls: 0,
      costUsd: 0,
    };

    const costByScope = (db.prepare(`
      SELECT COALESCE(work_scope, 'port_daddy_call') as scope,
        COUNT(*) as events,
        COALESCE(SUM(input_tokens), 0) as inputTokens,
        COALESCE(SUM(cached_input_tokens), 0) as cachedInputTokens,
        COALESCE(SUM(output_tokens), 0) as outputTokens,
        COALESCE(SUM(total_tokens), 0) as totalTokens,
        COALESCE(SUM(turns), 0) as turns,
        COALESCE(SUM(tool_calls), 0) as toolCalls,
        COALESCE(SUM(cost_usd), 0) as costUsd,
        COALESCE(SUM(CASE WHEN cost_is_estimate = 1 THEN 1 ELSE 0 END), 0) as estimatedCostEvents
      FROM usage_events
      WHERE timestamp >= ?
      GROUP BY COALESCE(work_scope, 'port_daddy_call')
      ORDER BY costUsd DESC, events DESC
    `).all(since) as UsageCostScopeRow[]).map((row) => ({
      ...row,
      costUsd: +Number(row.costUsd ?? 0).toFixed(6),
    }));

    const bySurface = toBreakdown(db.prepare(`
      SELECT surface as key, COUNT(*) as count
      FROM usage_events WHERE timestamp >= ?
      GROUP BY surface ORDER BY count DESC
    `).all(since) as Array<{ key: string; count: number }>, total.count);

    const byKind = toBreakdown(db.prepare(`
      SELECT kind as key, COUNT(*) as count
      FROM usage_events WHERE timestamp >= ?
      GROUP BY kind ORDER BY count DESC
    `).all(since) as Array<{ key: string; count: number }>, total.count);

    const byCategory = toBreakdown(db.prepare(`
      SELECT COALESCE(category, 'other') as key, COUNT(*) as count
      FROM usage_events WHERE timestamp >= ?
      GROUP BY COALESCE(category, 'other') ORDER BY count DESC
    `).all(since) as Array<{ key: string; count: number }>, total.count);

    const topNames = (db.prepare(`
      SELECT surface, kind, COALESCE(category, 'other') as category, name, COUNT(*) as count,
        ROUND(AVG(duration_ms), 0) as avgDurationMs,
        MAX(timestamp) as lastSeen
      FROM usage_events
      WHERE timestamp >= ?
      GROUP BY surface, kind, category, name
      ORDER BY count DESC, lastSeen DESC
      LIMIT ?
    `).all(since, limit) as Array<{
      surface: string;
      kind: string;
      category: string;
      name: string;
      count: number;
      avgDurationMs: number | null;
      lastSeen: number;
    }>).map((row) => ({
      surface: row.surface,
      kind: row.kind,
      category: row.category,
      name: row.name,
      count: row.count,
      avgDurationMs: row.avgDurationMs,
      lastSeen: row.lastSeen,
    }));

    const agentModels = (db.prepare(`
      SELECT COALESCE(agent_type, 'unknown') as agentType,
        COALESCE(agent_model, 'unknown') as agentModel,
        COALESCE(backend, 'unknown') as backend,
        COALESCE(model, 'unknown') as model,
        surface,
        COUNT(*) as count,
        MAX(timestamp) as lastSeen
      FROM usage_events
      WHERE timestamp >= ?
      GROUP BY agentType, agentModel, backend, model, surface
      ORDER BY count DESC, lastSeen DESC
      LIMIT ?
    `).all(since, limit) as UsageAgentModelRow[]);

    const capabilityRows = db.prepare(`
      SELECT COALESCE(category, 'other') as category, surface,
        COALESCE(agent_type, '') as agent_type,
        COALESCE(agent_model, '') as agent_model,
        COALESCE(backend, '') as backend,
        COALESCE(model, '') as model,
        COUNT(*) as count
      FROM usage_events
      WHERE timestamp >= ?
      GROUP BY category, surface, agent_type, agent_model, backend, model
      ORDER BY count DESC
    `).all(since) as Array<{
      category: string;
      surface: string;
      agent_type: string;
      agent_model: string;
      backend: string;
      model: string;
      count: number;
    }>;

    const capabilities = new Map<string, UsageCapabilityRow>();
    for (const cap of KNOWN_CAPABILITIES) {
      capabilities.set(cap, { category: cap, count: 0, surfaces: {}, models: [] });
    }

    const modelTotals = new Map<string, Map<string, number>>();
    for (const row of capabilityRows) {
      const current = capabilities.get(row.category) ?? { category: row.category, count: 0, surfaces: {}, models: [] };
      current.count += row.count;
      current.surfaces[row.surface] = (current.surfaces[row.surface] ?? 0) + row.count;
      capabilities.set(row.category, current);

      const modelLabel = labelModel(row);
      const perCategory = modelTotals.get(row.category) ?? new Map<string, number>();
      perCategory.set(modelLabel, (perCategory.get(modelLabel) ?? 0) + row.count);
      modelTotals.set(row.category, perCategory);
    }

    for (const [category, modelMap] of modelTotals.entries()) {
      const current = capabilities.get(category);
      if (!current) continue;
      current.models = [...modelMap.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    }

    const capabilityList = [...capabilities.values()].sort((a, b) => {
      if (a.count === 0 && b.count === 0) return a.category.localeCompare(b.category);
      return b.count - a.count;
    });

    const agentCapabilityMatrix = (db.prepare(`
      SELECT COALESCE(agent_type, 'unknown') as agentType,
        COALESCE(agent_model, 'unknown') as agentModel,
        COALESCE(backend, 'unknown') as backend,
        COALESCE(model, 'unknown') as model,
        COALESCE(category, 'other') as category,
        COUNT(*) as count
      FROM usage_events
      WHERE timestamp >= ?
      GROUP BY agentType, agentModel, backend, model, category
      ORDER BY count DESC
      LIMIT ?
    `).all(since, limit) as UsageAgentCapabilityRow[]);

    return {
      success: true,
      generatedAt,
      since,
      periodMs: generatedAt - since,
      build,
      totals: {
        events: total.count,
        uniqueAgents: total.uniqueAgents,
        uniqueProjects: total.uniqueProjects,
        uniqueModels: total.uniqueModels,
        inputTokens: total.inputTokens,
        cachedInputTokens: total.cachedInputTokens,
        outputTokens: total.outputTokens,
        totalTokens: total.totalTokens,
        turns: total.turns,
        toolCalls: total.toolCalls,
        costUsd: +Number(total.costUsd ?? 0).toFixed(6),
      },
      costByScope,
      bySurface,
      byKind,
      byCategory,
      topNames,
      agentModels,
      capabilities: capabilityList,
      agentCapabilityMatrix,
      unusedCapabilities: capabilityList.filter((row) => row.count === 0).map((row) => row.category),
      recent: recent(Math.min(limit, 120), since),
    };
  }

  return { record, recent, summary };
}

export type UsageTelemetry = ReturnType<typeof createUsageTelemetry>;
