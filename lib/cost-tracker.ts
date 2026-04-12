/**
 * Cost Tracker — per-spawn LLM cost recording.
 *
 * Records a cost event for every spawn. When token counts are available
 * (claude SDK backend), computes exact cost. Legacy or non-enforced paths can
 * still emit estimates for opaque backends, but live operator-facing launches
 * are expected to be blocked upstream unless exact telemetry is available.
 *
 * Usage:
 *   costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'myapp' })
 *   costTracker.total({ since: Date.now() - 86_400_000 })
 *   costTracker.summary()                           // by project, last 24h
 *   costTracker.budgetStatus('myapp', 5.00)         // $5/day budget check
 *
 * Rate table: update when Anthropic/Google change pricing.
 * Rates are in USD per 1M tokens.
 */

import type { Database } from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

// ─── Model Rate Table (USD per 1M tokens) ─────────────────────────────────────

interface ModelRate {
  input: number;   // USD per 1M input tokens
  output: number;  // USD per 1M output tokens
  label: string;
}

const FALLBACK_MODEL_RATES: Record<string, ModelRate> = {
  claude: { input: 3.00, output: 15.00, label: 'Claude fallback (Sonnet-class estimate)' },
  gemini: { input: 1.25, output: 5.00, label: 'Gemini fallback (Pro-class estimate)' },
};

// Keys are substrings — matched with .includes() against the model name.
// List more-specific keys before less-specific ones.
const MODEL_RATES: Array<[string, ModelRate]> = [
  // Anthropic — Opus
  ['claude-opus-4',           { input: 15.00, output: 75.00, label: 'Claude Opus 4' }],
  // Anthropic — Sonnet
  ['claude-sonnet-4-6',       { input:  3.00, output: 15.00, label: 'Claude Sonnet 4.6' }],
  ['claude-sonnet-4-5',       { input:  3.00, output: 15.00, label: 'Claude Sonnet 4.5' }],
  ['claude-3-5-sonnet',       { input:  3.00, output: 15.00, label: 'Claude 3.5 Sonnet' }],
  // Anthropic — Haiku
  ['claude-haiku-4-5',        { input:  0.80, output:  4.00, label: 'Claude Haiku 4.5' }],
  ['claude-3-5-haiku',        { input:  0.80, output:  4.00, label: 'Claude 3.5 Haiku' }],
  ['claude-haiku',            { input:  0.80, output:  4.00, label: 'Claude Haiku' }],
  // Gemini
  ['gemini-2.0-flash',        { input:  0.075, output: 0.30, label: 'Gemini 2.0 Flash' }],
  ['gemini-1.5-pro',          { input:  1.25, output:  5.00, label: 'Gemini 1.5 Pro' }],
  ['gemini-1.5-flash',        { input:  0.075, output: 0.30, label: 'Gemini 1.5 Flash' }],
];

/**
 * Flat per-session cost estimates for backends that don't expose token counts.
 * These are conservative estimates meant to flag usage, not for billing.
 * Update based on observed actual spend.
 */
const SESSION_ESTIMATES_USD: Record<string, number> = {
  'claude':     0.08,  // conservative floor for SDK calls when telemetry is partial/missing
  'claude-cli': 0.05,  // ~50k tokens/session at Sonnet pricing
  'gemini':     0.03,  // conservative floor for remote Gemini requests
  'aider':      0.10,  // aider makes multiple calls; typically 2-4 cycles
  'cloudflare': 0.05,  // remote inference via Cloudflare AI
  'custom':     0.00,  // unknown — assume free
  'ollama':     0.00,  // local — free
};

function estimateOpaqueSessionCost(backend: string, model: string): number {
  const normalizedModel = model.toLowerCase();
  if (backend === 'codex') {
    if (normalizedModel.includes('gpt-5.4-mini')) return 0.08;
    if (normalizedModel.includes('gpt-5.3-codex')) return 0.12;
    return 0.20;
  }
  if (backend === 'aider') {
    if (normalizedModel.includes('mini')) return 0.06;
    if (normalizedModel.includes('gpt-4.1')) return 0.10;
    if (normalizedModel.includes('gpt-5')) return 0.18;
    return 0.10;
  }
  return SESSION_ESTIMATES_USD[backend] ?? 0;
}

function hasKnownPaidRemoteBackend(backend: string): boolean {
  return ['claude', 'claude-cli', 'gemini', 'codex', 'aider', 'cloudflare'].includes(backend);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostRecordOpts {
  backend: string;
  model: string;
  projectName?: string;
  projectDir?: string;
  identity?: string;
  spawnId?: string;
  /** Input token count — when provided with outputTokens, computes exact cost */
  inputTokens?: number;
  outputTokens?: number;
}

export interface CostEvent {
  id: string;
  ts: number;
  backend: string;
  model: string;
  projectName: string | null;
  projectDir: string | null;
  identity: string | null;
  spawnId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  isEstimate: boolean;
}

export interface CostSummaryRow {
  projectName: string | null;
  projectDir: string | null;
  totalUsd: number;
  spawnCount: number;
  estimatedCount: number;
  topModel: string | null;
}

export interface CostTotals {
  totalUsd: number;
  spawnCount: number;
  estimatedCount: number;
}

export interface BudgetStatus {
  project: string;
  budgetUsdPerDay: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  overBudget: boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function findRate(model: string): ModelRate | null {
  const lc = model.toLowerCase();
  for (const [key, rate] of MODEL_RATES) {
    if (lc.includes(key)) return rate;
  }
  return null;
}

export function hasExactModelRate(model: string): boolean {
  return findRate(model) !== null;
}

function findFallbackRate(backend: string, model: string): ModelRate | null {
  const candidates = [model.toLowerCase(), backend.toLowerCase()];
  for (const candidate of candidates) {
    if (candidate.includes('claude')) return FALLBACK_MODEL_RATES.claude;
    if (candidate.includes('gemini')) return FALLBACK_MODEL_RATES.gemini;
  }
  return null;
}

function normalizeTokenCount(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, value);
}

function computeCost(
  backend: string,
  model: string,
  inputTokens?: number,
  outputTokens?: number,
): { costUsd: number; isEstimate: boolean } {
  const normalizedInput = normalizeTokenCount(inputTokens);
  const normalizedOutput = normalizeTokenCount(outputTokens);
  const exactRate = findRate(model);
  const fallbackRate = findFallbackRate(backend, model);
  const knownRate = exactRate || fallbackRate;
  const sessionEstimate = estimateOpaqueSessionCost(backend, model);

  // If we have token counts, use them exactly
  if (normalizedInput !== undefined && normalizedOutput !== undefined) {
    if (knownRate) {
      const costUsd = (normalizedInput / 1_000_000) * knownRate.input + (normalizedOutput / 1_000_000) * knownRate.output;
      return { costUsd: +Math.max(0, costUsd).toFixed(6), isEstimate: !exactRate };
    }
  }

  // Partial token telemetry on paid backends should still produce nonzero telemetry.
  if ((normalizedInput !== undefined || normalizedOutput !== undefined) && knownRate) {
    const inputEstimate = normalizedInput ?? normalizedOutput ?? 0;
    const outputEstimate = normalizedOutput ?? normalizedInput ?? 0;
    const tokenBasedEstimate =
      (inputEstimate / 1_000_000) * knownRate.input +
      (outputEstimate / 1_000_000) * knownRate.output;
    const floor = hasKnownPaidRemoteBackend(backend) ? Math.max(sessionEstimate, 0.01) : sessionEstimate;
    return {
      costUsd: +Math.max(tokenBasedEstimate, floor).toFixed(6),
      isEstimate: true,
    };
  }

  // Fall back to flat estimate
  const estimate = hasKnownPaidRemoteBackend(backend)
    ? Math.max(sessionEstimate, 0.01)
    : sessionEstimate;
  return { costUsd: estimate ?? 0, isEstimate: true };
}

// ─── Module factory ───────────────────────────────────────────────────────────

export function createCostTracker(db: Database) {
  db.exec(`
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
      output_tokens INTEGER,
      cost_usd     REAL    NOT NULL DEFAULT 0,
      is_estimate  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ce_ts      ON cost_events(ts);
    CREATE INDEX IF NOT EXISTS idx_ce_project ON cost_events(project_name, ts);
    CREATE INDEX IF NOT EXISTS idx_ce_backend ON cost_events(backend, ts);
  `);

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(cost_events)').all() as Array<{ name: string }>).map((column) => column.name)
  );
  if (!existingColumns.has('project_dir')) {
    db.exec('ALTER TABLE cost_events ADD COLUMN project_dir TEXT;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_ce_project_dir ON cost_events(project_dir, ts);');

  const insertStmt = db.prepare(`
    INSERT INTO cost_events
      (id, ts, backend, model, project_name, project_dir, identity, spawn_id,
       input_tokens, output_tokens, cost_usd, is_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  /**
   * Record a cost event for a completed spawn.
   * Safe to call fire-and-forget — never throws.
   */
  function record(opts: CostRecordOpts): CostEvent | null {
    try {
      const { costUsd, isEstimate } = computeCost(
        opts.backend, opts.model, opts.inputTokens, opts.outputTokens,
      );
      const id = randomBytes(8).toString('hex');
      const ts = Date.now();
      insertStmt.run(
        id, ts, opts.backend, opts.model,
        opts.projectName ?? null, opts.projectDir ?? null, opts.identity ?? null, opts.spawnId ?? null,
        opts.inputTokens ?? null, opts.outputTokens ?? null,
        costUsd, isEstimate ? 1 : 0,
      );
      return {
        id, ts,
        backend: opts.backend, model: opts.model,
        projectName: opts.projectName ?? null, projectDir: opts.projectDir ?? null, identity: opts.identity ?? null,
        spawnId: opts.spawnId ?? null,
        inputTokens: opts.inputTokens ?? null, outputTokens: opts.outputTokens ?? null,
        costUsd, isEstimate,
      };
    } catch {
      return null;
    }
  }

  /** Total cost and spawn count over a time window. Default: last 24h. */
  function total(opts?: { since?: number }): CostTotals {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as total, COUNT(*) as count, COALESCE(SUM(is_estimate), 0) as est
      FROM cost_events WHERE ts >= ?
    `).get(since) as { total: number; count: number; est: number };
    return { totalUsd: +row.total.toFixed(6), spawnCount: row.count, estimatedCount: row.est };
  }

  /** Cost broken down by project. Default: last 24h. */
  function summary(opts?: { since?: number; projectName?: string; projectDir?: string }): CostSummaryRow[] {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const conditions = ['ts >= ?'];
    const params: unknown[] = [since];

    if (opts?.projectName) {
      conditions.push('project_name = ?');
      params.push(opts.projectName);
    }
    if (opts?.projectDir) {
      conditions.push('project_dir = ?');
      params.push(opts.projectDir);
    }

    const whereClause = conditions.join(' AND ');

    // Single query using CTE + window function — eliminates N+1 per-project top-model loop.
    interface RawRow {
      project_name: string | null;
      project_dir: string | null;
      total_usd: number;
      spawn_count: number;
      estimated_count: number;
      top_model: string | null;
    }

    const rows = db.prepare(`
      WITH filtered AS (
        SELECT * FROM cost_events WHERE ${whereClause}
      ),
      agg AS (
        SELECT project_name, project_dir, SUM(cost_usd) AS total_usd, COUNT(*) AS spawn_count, SUM(is_estimate) AS estimated_count
        FROM filtered GROUP BY project_name, project_dir
      ),
      model_counts AS (
        SELECT project_name, project_dir, model, COUNT(*) AS cnt
        FROM filtered GROUP BY project_name, project_dir, model
      ),
      top_models AS (
        SELECT project_name, project_dir, model,
               ROW_NUMBER() OVER (PARTITION BY project_name, project_dir ORDER BY cnt DESC) AS rn
        FROM model_counts
      )
      SELECT a.project_name, a.project_dir, a.total_usd, a.spawn_count, a.estimated_count, t.model AS top_model
      FROM agg a
      LEFT JOIN top_models t
        ON t.project_name IS a.project_name
       AND t.project_dir IS a.project_dir
       AND t.rn = 1
      ORDER BY a.total_usd DESC
    `).all(...params) as RawRow[];

    return rows.map(r => ({
      projectName: r.project_name,
      projectDir: r.project_dir,
      totalUsd: +r.total_usd.toFixed(6),
      spawnCount: r.spawn_count,
      estimatedCount: r.estimated_count,
      topModel: r.top_model ?? null,
    }));
  }

  /** Cost broken down by backend. Default: last 24h. */
  function byBackend(opts?: { since?: number }): Array<{ backend: string; totalUsd: number; count: number }> {
    const since = opts?.since ?? Date.now() - 86_400_000;
    const rows = db.prepare(`
      SELECT backend, SUM(cost_usd) as total_usd, COUNT(*) as count
      FROM cost_events WHERE ts >= ?
      GROUP BY backend ORDER BY total_usd DESC
    `).all(since) as { backend: string; total_usd: number; count: number }[];
    return rows.map(r => ({ backend: r.backend, totalUsd: +r.total_usd.toFixed(6), count: r.count }));
  }

  /** Most recent N cost events. */
  function recent(limit = 50): CostEvent[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 50;
    const n = Math.max(0, Math.min(normalizedLimit, 500));
    interface RawEvent {
      id: string; ts: number; backend: string; model: string;
      project_name: string | null; project_dir: string | null; identity: string | null; spawn_id: string | null;
      input_tokens: number | null; output_tokens: number | null;
      cost_usd: number; is_estimate: number;
    }
    const rows = db.prepare(`
      SELECT * FROM cost_events ORDER BY ts DESC LIMIT ?
    `).all(n) as RawEvent[];
    return rows.map(r => ({
      id: r.id, ts: r.ts, backend: r.backend, model: r.model,
      projectName: r.project_name, projectDir: r.project_dir, identity: r.identity, spawnId: r.spawn_id,
      inputTokens: r.input_tokens, outputTokens: r.output_tokens,
      costUsd: r.cost_usd, isEstimate: r.is_estimate === 1,
    }));
  }

  /**
   * Check a project's spend against a daily budget.
   * @param projectName  project to check
   * @param budgetUsdPerDay daily budget ceiling in USD
   * @param since        window start (default: last 24h)
   */
  function budgetStatus(projectName: string, budgetUsdPerDay: number, since?: number): BudgetStatus {
    const row = db.prepare(`
      SELECT COALESCE(SUM(cost_usd), 0) as spent
      FROM cost_events WHERE (project_name = ? OR project_dir = ?) AND ts >= ?
    `).get(projectName, projectName, since ?? Date.now() - 86_400_000) as { spent: number };
    const spentUsd = +row.spent.toFixed(6);
    const percentUsed = budgetUsdPerDay > 0
      ? +((spentUsd / budgetUsdPerDay) * 100).toFixed(1)
      : spentUsd > 0 ? 100 : 0;
    return {
      project: projectName,
      budgetUsdPerDay,
      spentUsd,
      remainingUsd: Math.max(0, +(budgetUsdPerDay - spentUsd).toFixed(6)),
      percentUsed,
      overBudget: spentUsd > budgetUsdPerDay,
    };
  }

  return { record, total, summary, byBackend, recent, budgetStatus, computeCost };
}

export type CostTracker = ReturnType<typeof createCostTracker>;
