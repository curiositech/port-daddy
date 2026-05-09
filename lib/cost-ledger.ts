/**
 * Cost ledger — unified rollup layer over `cost_events` (spawner-level
 * cost-tracker rows, one per agent process) and `transcript_events`
 * (one row per LLM turn from lib/llm-call.ts). Both surfaces persist
 * cost_usd; this module joins them into a single time-anchored stream
 * so `pd costs` can answer "spend by actor / backend / model in the
 * last hour|day|week|month|all-time" without callers caring which
 * subsystem booked the charge.
 *
 * Why two tables: cost-tracker predates the transcript store. Spawned
 * agents that don't go through llm-call (Claude CLI, Codex CLI) only
 * land in cost_events; in-process Cloudflare/Haiku turns only land in
 * transcript_events. Migrating one into the other would lose detail —
 * cost_events has spawn_id and project_dir, transcript_events has
 * session_id and turnId. Union view preserves both vocabularies.
 *
 * Caps live in their own table so the user can edit thresholds without
 * touching code or YAML. Caller seeds them from config/plans.yaml or
 * PD_*_CAP env overrides; the ledger itself stays config-agnostic.
 */

import type Database from 'better-sqlite3';

export type RollupWindow = 'hour' | 'day' | 'week' | 'month' | 'all';
export type LedgerSlice = 'actor' | 'backend' | 'model' | 'project' | 'session';
export type CapWindow = Exclude<RollupWindow, 'all'>;
export type CapScope = 'global' | 'actor' | 'project' | 'backend';

const WINDOW_MS: Record<RollupWindow, number | null> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // 30d, calendar months would need TZ context
  all: null,
};

export interface CostLedgerRow {
  ts: number;
  costUsd: number;
  model: string | null;
  backend: string | null;
  actor: string | null;
  sessionId: string | null;
  projectName: string | null;
  projectDir: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  source: 'transcript' | 'spawn';
}

export interface RollupTotals {
  window: RollupWindow;
  since: number | null;
  totalUsd: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface SliceRow {
  key: string;
  totalUsd: number;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Cap {
  id: number;
  scope: CapScope;
  /** Empty string for global; actor name / project name / backend name otherwise. */
  scopeKey: string;
  window: CapWindow;
  usdLimit: number;
}

export interface CapProximity {
  cap: Cap;
  spentUsd: number;
  percentUsed: number;
  remainingUsd: number;
  exceeded: boolean;
}

export interface CostLedgerOptions {
  now?: () => number;
  /** Default 0.8 — caps below this fraction of usage are not flagged as
   *  near-cap. Set to 0 to flag every cap. */
  proximityThreshold?: number;
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS cost_caps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    scope_key TEXT NOT NULL DEFAULT '',
    window TEXT NOT NULL,
    usd_limit REAL NOT NULL,
    UNIQUE(scope, scope_key, window)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cost_caps_lookup ON cost_caps(scope, scope_key, window)`,
];

const VIEW_SQL = `
  CREATE VIEW IF NOT EXISTS cost_ledger_v AS
  SELECT
    ts, cost_usd, model, backend,
    actor_id          AS actor,
    session_id        AS session_id,
    NULL              AS project_name,
    NULL              AS project_dir,
    tokens_in         AS input_tokens,
    tokens_out        AS output_tokens,
    cached_tokens_in  AS cached_input_tokens,
    'transcript'      AS source
  FROM transcript_events
  WHERE event_type = 'turn_complete' AND cost_usd IS NOT NULL
  UNION ALL
  SELECT
    ts, cost_usd, model, backend,
    identity            AS actor,
    NULL                AS session_id,
    project_name,
    project_dir,
    input_tokens,
    output_tokens,
    cached_input_tokens,
    'spawn'             AS source
  FROM cost_events
`;

const SLICE_COL: Record<LedgerSlice, string> = {
  actor: 'actor',
  backend: 'backend',
  model: 'model',
  project: 'project_name',
  session: 'session_id',
};

const VALID_WINDOWS: RollupWindow[] = ['hour', 'day', 'week', 'month', 'all'];
const VALID_CAP_WINDOWS: CapWindow[] = ['hour', 'day', 'week', 'month'];
const VALID_SCOPES: CapScope[] = ['global', 'actor', 'project', 'backend'];
const VALID_SLICES: LedgerSlice[] = ['actor', 'backend', 'model', 'project', 'session'];

export interface CostLedger {
  rollup(opts?: { window?: RollupWindow; filter?: LedgerFilter }): RollupTotals;
  bySlice(slice: LedgerSlice, opts?: { window?: RollupWindow; limit?: number; filter?: LedgerFilter }): SliceRow[];
  recent(opts?: { limit?: number; filter?: LedgerFilter }): CostLedgerRow[];
  setCap(scope: CapScope, scopeKey: string, window: CapWindow, usdLimit: number): Cap;
  removeCap(id: number): boolean;
  listCaps(scope?: CapScope): Cap[];
  capsStatus(opts?: { onlyNear?: boolean }): CapProximity[];
}

export interface LedgerFilter {
  actor?: string;
  backend?: string;
  model?: string;
  projectName?: string;
  sessionId?: string;
}

export function createCostLedger(
  db: Database.Database,
  options: CostLedgerOptions = {},
): CostLedger {
  const now = options.now ?? Date.now;
  const proximityThreshold = options.proximityThreshold ?? 0.8;

  for (const stmt of SCHEMA) db.prepare(stmt).run();
  // The view depends on transcript_events and cost_events; both are
  // created idempotently by their owning modules. If neither has been
  // initialized yet we still want the view to exist so queries return
  // zero rows rather than throwing.
  ensureSourceTables(db);
  db.prepare(VIEW_SQL).run();

  const insertCapStmt = db.prepare(
    `INSERT INTO cost_caps (scope, scope_key, window, usd_limit) VALUES (?, ?, ?, ?)
     ON CONFLICT(scope, scope_key, window) DO UPDATE SET usd_limit = excluded.usd_limit`,
  );
  const selectCapStmt = db.prepare(
    `SELECT id, scope, scope_key, window, usd_limit FROM cost_caps
       WHERE scope = ? AND scope_key = ? AND window = ?`,
  );
  const deleteCapStmt = db.prepare(`DELETE FROM cost_caps WHERE id = ?`);
  const listCapsStmt = db.prepare(
    `SELECT id, scope, scope_key, window, usd_limit FROM cost_caps ORDER BY scope, scope_key, window`,
  );
  const listCapsByScopeStmt = db.prepare(
    `SELECT id, scope, scope_key, window, usd_limit FROM cost_caps WHERE scope = ? ORDER BY scope_key, window`,
  );

  function buildFilterClause(filter?: LedgerFilter): { clause: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    if (!filter) return { clause: '', params };
    if (filter.actor) { parts.push('actor = ?'); params.push(filter.actor); }
    if (filter.backend) { parts.push('backend = ?'); params.push(filter.backend); }
    if (filter.model) { parts.push('model = ?'); params.push(filter.model); }
    if (filter.projectName) { parts.push('project_name = ?'); params.push(filter.projectName); }
    if (filter.sessionId) { parts.push('session_id = ?'); params.push(filter.sessionId); }
    return { clause: parts.length ? parts.join(' AND ') : '', params };
  }

  function rollup(opts?: { window?: RollupWindow; filter?: LedgerFilter }): RollupTotals {
    const window = opts?.window ?? 'day';
    if (!VALID_WINDOWS.includes(window)) {
      throw new Error(`cost-ledger: invalid window "${window}"`);
    }
    const ms = WINDOW_MS[window];
    const since = ms == null ? null : now() - ms;
    const filter = buildFilterClause(opts?.filter);

    const where: string[] = [];
    const params: unknown[] = [];
    if (since != null) { where.push('ts >= ?'); params.push(since); }
    if (filter.clause) { where.push(filter.clause); params.push(...filter.params); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const row = db.prepare(`
      SELECT
        COALESCE(SUM(cost_usd), 0)            AS total_usd,
        COUNT(*)                              AS turn_count,
        COALESCE(SUM(input_tokens), 0)        AS input_tokens,
        COALESCE(SUM(output_tokens), 0)       AS output_tokens,
        COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens
      FROM cost_ledger_v
      ${whereSql}
    `).get(...params) as {
      total_usd: number; turn_count: number;
      input_tokens: number; output_tokens: number; cached_input_tokens: number;
    };

    return {
      window,
      since,
      totalUsd: round6(row.total_usd),
      turnCount: row.turn_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cachedInputTokens: row.cached_input_tokens,
    };
  }

  function bySlice(
    slice: LedgerSlice,
    opts?: { window?: RollupWindow; limit?: number; filter?: LedgerFilter },
  ): SliceRow[] {
    if (!VALID_SLICES.includes(slice)) {
      throw new Error(`cost-ledger: invalid slice "${slice}"`);
    }
    const window = opts?.window ?? 'day';
    const limit = clampLimit(opts?.limit, 100, 1, 1000);
    const ms = WINDOW_MS[window];
    const since = ms == null ? null : now() - ms;
    const filter = buildFilterClause(opts?.filter);
    const col = SLICE_COL[slice];

    const where: string[] = [`${col} IS NOT NULL`];
    const params: unknown[] = [];
    if (since != null) { where.push('ts >= ?'); params.push(since); }
    if (filter.clause) { where.push(filter.clause); params.push(...filter.params); }
    const whereSql = `WHERE ${where.join(' AND ')}`;

    interface Raw {
      key: string; total_usd: number; turn_count: number;
      input_tokens: number; output_tokens: number;
    }
    const rows = db.prepare(`
      SELECT
        ${col}                          AS key,
        SUM(cost_usd)                   AS total_usd,
        COUNT(*)                        AS turn_count,
        COALESCE(SUM(input_tokens), 0)  AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens
      FROM cost_ledger_v
      ${whereSql}
      GROUP BY ${col}
      ORDER BY total_usd DESC
      LIMIT ?
    `).all(...params, limit) as Raw[];

    return rows.map(r => ({
      key: r.key,
      totalUsd: round6(r.total_usd),
      turnCount: r.turn_count,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
    }));
  }

  function recent(opts?: { limit?: number; filter?: LedgerFilter }): CostLedgerRow[] {
    const limit = clampLimit(opts?.limit, 50, 1, 1000);
    const filter = buildFilterClause(opts?.filter);
    const whereSql = filter.clause ? `WHERE ${filter.clause}` : '';
    interface Raw {
      ts: number; cost_usd: number; model: string | null; backend: string | null;
      actor: string | null; session_id: string | null;
      project_name: string | null; project_dir: string | null;
      input_tokens: number | null; output_tokens: number | null; cached_input_tokens: number | null;
      source: 'transcript' | 'spawn';
    }
    const rows = db.prepare(`
      SELECT * FROM cost_ledger_v ${whereSql} ORDER BY ts DESC LIMIT ?
    `).all(...filter.params, limit) as Raw[];
    return rows.map(r => ({
      ts: r.ts,
      costUsd: round6(r.cost_usd),
      model: r.model, backend: r.backend,
      actor: r.actor, sessionId: r.session_id,
      projectName: r.project_name, projectDir: r.project_dir,
      inputTokens: r.input_tokens, outputTokens: r.output_tokens,
      cachedInputTokens: r.cached_input_tokens,
      source: r.source,
    }));
  }

  function setCap(scope: CapScope, scopeKey: string, window: CapWindow, usdLimit: number): Cap {
    if (!VALID_SCOPES.includes(scope)) throw new Error(`cost-ledger: invalid cap scope "${scope}"`);
    if (!VALID_CAP_WINDOWS.includes(window)) throw new Error(`cost-ledger: invalid cap window "${window}"`);
    if (!Number.isFinite(usdLimit) || usdLimit < 0) {
      throw new Error(`cost-ledger: usdLimit must be a non-negative finite number, got ${usdLimit}`);
    }
    if (scope === 'global' && scopeKey !== '') {
      throw new Error('cost-ledger: global scope must have empty scopeKey');
    }
    if (scope !== 'global' && !scopeKey) {
      throw new Error(`cost-ledger: ${scope} scope requires non-empty scopeKey`);
    }
    insertCapStmt.run(scope, scopeKey, window, usdLimit);
    const row = selectCapStmt.get(scope, scopeKey, window) as {
      id: number; scope: CapScope; scope_key: string; window: CapWindow; usd_limit: number;
    };
    return { id: row.id, scope: row.scope, scopeKey: row.scope_key, window: row.window, usdLimit: row.usd_limit };
  }

  function removeCap(id: number): boolean {
    const result = deleteCapStmt.run(id);
    return result.changes > 0;
  }

  function listCaps(scope?: CapScope): Cap[] {
    const rows = (scope ? listCapsByScopeStmt.all(scope) : listCapsStmt.all()) as Array<{
      id: number; scope: CapScope; scope_key: string; window: CapWindow; usd_limit: number;
    }>;
    return rows.map(r => ({
      id: r.id, scope: r.scope, scopeKey: r.scope_key, window: r.window, usdLimit: r.usd_limit,
    }));
  }

  function capsStatus(opts?: { onlyNear?: boolean }): CapProximity[] {
    const onlyNear = opts?.onlyNear ?? false;
    const caps = listCaps();
    const out: CapProximity[] = [];
    for (const cap of caps) {
      const filter: LedgerFilter | undefined =
        cap.scope === 'global'   ? undefined :
        cap.scope === 'actor'    ? { actor: cap.scopeKey } :
        cap.scope === 'project'  ? { projectName: cap.scopeKey } :
        cap.scope === 'backend'  ? { backend: cap.scopeKey } :
        undefined;
      const spent = rollup({ window: cap.window, filter }).totalUsd;
      const percentUsed = cap.usdLimit > 0
        ? +((spent / cap.usdLimit) * 100).toFixed(2)
        : spent > 0 ? Infinity : 0;
      const proximity: CapProximity = {
        cap,
        spentUsd: spent,
        percentUsed,
        remainingUsd: round6(Math.max(0, cap.usdLimit - spent)),
        exceeded: spent > cap.usdLimit,
      };
      if (!onlyNear || percentUsed >= proximityThreshold * 100) out.push(proximity);
    }
    return out.sort((a, b) => b.percentUsed - a.percentUsed);
  }

  return { rollup, bySlice, recent, setCap, removeCap, listCaps, capsStatus };
}

function ensureSourceTables(db: Database.Database): void {
  // Idempotent shells matching the live schemas. The owning modules
  // (transcript-store, cost-tracker) re-create with full indexes on
  // their own init paths; we just need the columns to exist so the
  // view is valid even when this module loads first.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS transcript_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      session_id TEXT,
      turn_id TEXT NOT NULL,
      role TEXT NOT NULL,
      event_type TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      cached_tokens_in INTEGER,
      model TEXT,
      backend TEXT,
      cost_usd REAL,
      metadata TEXT,
      ts INTEGER NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS cost_events (
      id           TEXT    PRIMARY KEY,
      ts           INTEGER NOT NULL,
      backend      TEXT    NOT NULL,
      model        TEXT    NOT NULL,
      project_name TEXT,
      project_dir  TEXT,
      identity     TEXT,
      spawn_id     TEXT,
      input_tokens  INTEGER,
      cached_input_tokens INTEGER,
      output_tokens INTEGER,
      cost_usd     REAL    NOT NULL DEFAULT 0,
      is_estimate  INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}

function round6(n: number): number {
  return +n.toFixed(6);
}

function clampLimit(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.max(min, Math.min(n, max));
}
