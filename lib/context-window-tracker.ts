/**
 * Context Window Tracker — effective context health per agent.
 *
 * Advertised context windows do not equal useful context windows.
 * Empirical evidence (Hong & Sun 2025; Anthropic 2025) shows severe quality
 * degradation well before the advertised limit. We model effective capacity
 * as 60% of advertised and define pressure thresholds relative to that.
 *
 * Pressure levels (fraction of EFFECTIVE capacity):
 *   ok       < 50%
 *   warn     50% – 69%
 *   critical ≥ 70%
 *
 * Schema managed here (self-initialising, idempotent):
 *   agent_context_health  — last known health per agent (upserted on heartbeat)
 *   agent_task_ledger     — per-sortie COGS row (append-only)
 */

import type { Database } from 'better-sqlite3';

// ─────────────────────────────────────────────────────────────────────────────
// Effective context windows (60 % of advertised)
// ─────────────────────────────────────────────────────────────────────────────

/** Map from canonical model ID prefix → effective token limit (60 % of advertised). */
export const EFFECTIVE_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic — 200k advertised
  'claude-opus-4': 120_000,
  'claude-sonnet-4': 120_000,
  'claude-haiku-4': 120_000,
  // Anthropic Opus 5 / Sonnet 5 / Fable 5 — 1M advertised (config/models.yaml).
  // `claude-haiku-4-5` is unaffected: it still matches the `claude-haiku-4`
  // prefix above at the same 200k advertised window.
  'claude-opus-5': 600_000,
  'claude-sonnet-5': 600_000,
  'claude-fable-5': 600_000,
  // Legacy Anthropic shortnames
  'claude-3-5-sonnet': 120_000,
  'claude-3-5-haiku': 120_000,
  'claude-3-opus': 120_000,
  // Google Gemini — 1M advertised
  'gemini-2.5-pro': 600_000,
  'gemini-2.5-flash': 600_000,
  'gemini-2.5-flash-lite': 600_000,
  // OpenAI mini/nano — 16k advertised (must be listed BEFORE the 128k prefixes)
  'gpt-4o-mini': 9_600,
  'gpt-4.1-mini': 9_600,
  'gpt-5-nano': 9_600,
  'gpt-5-mini': 9_600,
  // OpenAI full — 128k advertised
  'gpt-4o': 76_800,
  'gpt-4.1': 76_800,
  'gpt-5': 76_800,
  'o4': 76_800,
  // Ollama / custom: conservatively assume 4k effective
  'ollama': 4_000,
};

const DEFAULT_EFFECTIVE_WINDOW = 60_000; // fallback for unknown models

/**
 * Look up the effective context window for a model.
 * Matches by prefix so 'claude-sonnet-4-6' matches 'claude-sonnet-4'.
 */
export function getEffectiveContextWindow(model: string): number {
  const lower = model.toLowerCase();
  for (const [prefix, limit] of Object.entries(EFFECTIVE_CONTEXT_WINDOWS)) {
    if (lower.startsWith(prefix)) return limit;
  }
  return DEFAULT_EFFECTIVE_WINDOW;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pressure levels
// ─────────────────────────────────────────────────────────────────────────────

export type PressureLevel = 'ok' | 'warn' | 'critical';

export function computePressureLevel(usedPct: number): PressureLevel {
  if (usedPct >= 0.7) return 'critical';
  if (usedPct >= 0.5) return 'warn';
  return 'ok';
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextHealth {
  agentId: string;
  model: string;
  tokensUsed: number;
  effectiveMax: number;
  usedPct: number;
  pressureLevel: PressureLevel;
  remaining: number;
  updatedAt: string;
}

export interface TaskLedgerRow {
  id: string;
  agentId: string;
  sessionId: string | null;
  sortieId: string | null;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  effectiveContextMax: number;
  contextWindowUsedPct: number | null;
  costUsd: number;
  costIsEstimate: boolean;
  landedWork: string | null;
  recordedAt: string;
}

export interface TaskLedgerInput {
  agentId: string;
  sessionId?: string | null;
  sortieId?: string | null;
  model: string;
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  totalTokens?: number;
  contextWindowUsedPct?: number | null;
  costUsd: number;
  costIsEstimate?: boolean;
  landedWork?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

export const CONTEXT_TRACKER_SCHEMA = `
  CREATE TABLE IF NOT EXISTS agent_context_health (
    agent_id         TEXT PRIMARY KEY,
    model            TEXT NOT NULL,
    tokens_used      INTEGER NOT NULL DEFAULT 0,
    effective_max    INTEGER NOT NULL,
    used_pct         REAL NOT NULL DEFAULT 0,
    pressure_level   TEXT NOT NULL DEFAULT 'ok',
    updated_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_context_health_pressure
    ON agent_context_health(pressure_level);

  CREATE TABLE IF NOT EXISTS agent_task_ledger (
    id                       TEXT PRIMARY KEY,
    agent_id                 TEXT NOT NULL,
    session_id               TEXT,
    sortie_id                TEXT,
    model                    TEXT NOT NULL,
    input_tokens             INTEGER NOT NULL DEFAULT 0,
    cached_input_tokens      INTEGER NOT NULL DEFAULT 0,
    output_tokens            INTEGER NOT NULL DEFAULT 0,
    total_tokens             INTEGER NOT NULL DEFAULT 0,
    effective_context_max    INTEGER NOT NULL,
    context_window_used_pct  REAL,
    cost_usd                 REAL NOT NULL DEFAULT 0,
    cost_is_estimate         INTEGER NOT NULL DEFAULT 1,
    landed_work              TEXT,
    recorded_at              TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_agent
    ON agent_task_ledger(agent_id, recorded_at);
  CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_sortie
    ON agent_task_ledger(sortie_id) WHERE sortie_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_agent_task_ledger_date
    ON agent_task_ledger(recorded_at);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

export function createContextWindowTracker(db: Database) {
  db.exec(CONTEXT_TRACKER_SCHEMA);

  function upsertContextHealth(
    agentId: string,
    model: string,
    tokensUsed: number,
  ): ContextHealth {
    const effectiveMax = getEffectiveContextWindow(model);
    const usedPct = effectiveMax > 0 ? tokensUsed / effectiveMax : 0;
    const pressureLevel = computePressureLevel(usedPct);
    const updatedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_context_health
        (agent_id, model, tokens_used, effective_max, used_pct, pressure_level, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        model          = excluded.model,
        tokens_used    = excluded.tokens_used,
        effective_max  = excluded.effective_max,
        used_pct       = excluded.used_pct,
        pressure_level = excluded.pressure_level,
        updated_at     = excluded.updated_at
    `).run(agentId, model, tokensUsed, effectiveMax, usedPct, pressureLevel, updatedAt);

    return {
      agentId,
      model,
      tokensUsed,
      effectiveMax,
      usedPct,
      pressureLevel,
      remaining: Math.max(0, effectiveMax - tokensUsed),
      updatedAt,
    };
  }

  function getContextHealth(agentId: string): ContextHealth | null {
    const row = db.prepare(`
      SELECT agent_id, model, tokens_used, effective_max, used_pct, pressure_level, updated_at
      FROM agent_context_health WHERE agent_id = ?
    `).get(agentId) as Record<string, unknown> | undefined;

    if (!row) return null;
    return {
      agentId: row.agent_id as string,
      model: row.model as string,
      tokensUsed: row.tokens_used as number,
      effectiveMax: row.effective_max as number,
      usedPct: row.used_pct as number,
      pressureLevel: row.pressure_level as PressureLevel,
      remaining: Math.max(0, (row.effective_max as number) - (row.tokens_used as number)),
      updatedAt: row.updated_at as string,
    };
  }

  function getSwarmContextSummary(projectFilter?: string): ContextHealth[] {
    const rows = db.prepare(`
      SELECT agent_id, model, tokens_used, effective_max, used_pct, pressure_level, updated_at
      FROM agent_context_health
      ORDER BY used_pct DESC
    `).all() as Record<string, unknown>[];

    return rows
      .filter(row => !projectFilter || (row.agent_id as string).startsWith(projectFilter))
      .map(row => ({
        agentId: row.agent_id as string,
        model: row.model as string,
        tokensUsed: row.tokens_used as number,
        effectiveMax: row.effective_max as number,
        usedPct: row.used_pct as number,
        pressureLevel: row.pressure_level as PressureLevel,
        remaining: Math.max(0, (row.effective_max as number) - (row.tokens_used as number)),
        updatedAt: row.updated_at as string,
      }));
  }

  function appendTaskLedger(input: TaskLedgerInput): TaskLedgerRow {
    const id = crypto.randomUUID();
    const effectiveMax = getEffectiveContextWindow(input.model);
    const totalTokens = input.totalTokens ?? (input.inputTokens + input.outputTokens);
    const cachedInputTokens = input.cachedInputTokens ?? 0;
    const recordedAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO agent_task_ledger
        (id, agent_id, session_id, sortie_id, model,
         input_tokens, cached_input_tokens, output_tokens, total_tokens,
         effective_context_max, context_window_used_pct,
         cost_usd, cost_is_estimate, landed_work, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.agentId, input.sessionId ?? null, input.sortieId ?? null, input.model,
      input.inputTokens, cachedInputTokens, input.outputTokens, totalTokens,
      effectiveMax, input.contextWindowUsedPct ?? null,
      input.costUsd, input.costIsEstimate === false ? 0 : 1,
      input.landedWork ?? null, recordedAt,
    );

    return {
      id, agentId: input.agentId, sessionId: input.sessionId ?? null,
      sortieId: input.sortieId ?? null, model: input.model,
      inputTokens: input.inputTokens, cachedInputTokens, outputTokens: input.outputTokens,
      totalTokens, effectiveContextMax: effectiveMax,
      contextWindowUsedPct: input.contextWindowUsedPct ?? null,
      costUsd: input.costUsd, costIsEstimate: input.costIsEstimate !== false,
      landedWork: input.landedWork ?? null, recordedAt,
    };
  }

  function updateLandedWork(id: string, landedWork: string): void {
    db.prepare(`UPDATE agent_task_ledger SET landed_work = ? WHERE id = ?`).run(landedWork, id);
  }

  function getTaskLedger(
    agentId?: string,
    since?: string,
    limit = 100,
  ): TaskLedgerRow[] {
    let sql = `SELECT * FROM agent_task_ledger WHERE 1=1`;
    const params: unknown[] = [];
    if (agentId) { sql += ` AND agent_id = ?`; params.push(agentId); }
    if (since) { sql += ` AND recorded_at >= ?`; params.push(since); }
    sql += ` ORDER BY recorded_at DESC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(row => ({
      id: row.id as string,
      agentId: row.agent_id as string,
      sessionId: row.session_id as string | null,
      sortieId: row.sortie_id as string | null,
      model: row.model as string,
      inputTokens: row.input_tokens as number,
      cachedInputTokens: row.cached_input_tokens as number,
      outputTokens: row.output_tokens as number,
      totalTokens: row.total_tokens as number,
      effectiveContextMax: row.effective_context_max as number,
      contextWindowUsedPct: row.context_window_used_pct as number | null,
      costUsd: row.cost_usd as number,
      costIsEstimate: !!(row.cost_is_estimate as number),
      landedWork: row.landed_work as string | null,
      recordedAt: row.recorded_at as string,
    }));
  }

  function getDailyCostByAgent(date?: string): Array<{ agentId: string; costUsd: number; totalTokens: number }> {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT agent_id, SUM(cost_usd) as cost_usd, SUM(total_tokens) as total_tokens
      FROM agent_task_ledger
      WHERE date(recorded_at) = ?
      GROUP BY agent_id
      ORDER BY cost_usd DESC
    `).all(d) as Record<string, unknown>[];

    return rows.map(row => ({
      agentId: row.agent_id as string,
      costUsd: row.cost_usd as number,
      totalTokens: row.total_tokens as number,
    }));
  }

  function getSwarmDailyCostUsd(date?: string): number {
    const d = date ?? new Date().toISOString().slice(0, 10);
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total FROM agent_task_ledger WHERE date(recorded_at) = ?
    `).get(d) as { total: number };
    return row.total;
  }

  return {
    upsertContextHealth,
    getContextHealth,
    getSwarmContextSummary,
    appendTaskLedger,
    updateLandedWork,
    getTaskLedger,
    getDailyCostByAgent,
    getSwarmDailyCostUsd,
  };
}

export type ContextWindowTracker = ReturnType<typeof createContextWindowTracker>;
