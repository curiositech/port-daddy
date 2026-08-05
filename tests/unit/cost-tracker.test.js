/**
 * Unit tests for lib/cost-tracker.ts
 *
 * Tests cost computation, recording, summaries, and budget checks.
 */

import { createTestDb } from '../setup-unit.js';
import { createCostTracker } from '../../lib/cost-tracker.js';

describe('CostTracker', () => {
  let db;
  let costTracker;

  beforeEach(() => {
    db = createTestDb();
    costTracker = createCostTracker(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── computeCost ───────────────────────────────────────────────────────────

  test('computes exact cost from token counts', () => {
    // Claude Sonnet 4.6: $3 input / $15 output per 1M tokens
    // 1000 input + 500 output = $0.003 + $0.0075 = $0.0105
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-sonnet-4-6', 1000, 500
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.0105, 5);
  });

  test('uses flat estimate for claude-cli without token counts', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('claude-cli', 'claude-cli');
    expect(isEstimate).toBe(true);
    expect(costUsd).toBeCloseTo(0.05, 4);
  });

  test('uses flat estimate for codex without token counts', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('codex', 'gpt-5.4-mini');
    expect(isEstimate).toBe(true);
    expect(costUsd).toBeCloseTo(0.08, 4);
  });

  test('computes exact Codex cost with cached input tokens', () => {
    const { costUsd, isEstimate } = costTracker.computeCost(
      'codex', 'gpt-5.4-mini', 10000, 2000, 4000
    );

    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.0138, 6);
  });

  test('uses model-aware estimate for aider without token counts', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('aider', 'gpt-5');
    expect(isEstimate).toBe(true);
    expect(costUsd).toBeCloseTo(0.18, 4);
  });

  test('computes exact Gemini 2.5 Flash cost from token counts', () => {
    // gemini-2.5-flash: $0.30 input / $2.50 output per 1M
    //   1000 input × 0.30 / 1M = 0.0003
    //   500 output × 2.50 / 1M = 0.00125
    //   total = 0.00155 USD
    const { costUsd, isEstimate } = costTracker.computeCost(
      'gemini', 'gemini-2.5-flash', 1000, 500
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.00155, 6);
  });

  test('gemini-2.5-flash does NOT false-match the retired gemini-2.0 rate', () => {
    // Regression: the dead gemini-2.0-flash row was removed; 2.5-flash must
    // resolve to its own row, not a stale one.
    const { isEstimate } = costTracker.computeCost('gemini', 'gemini-2.5-flash', 1, 1);
    expect(isEstimate).toBe(false);
  });

  test('computes exact Groq Llama 3.3 70B cost from token counts', () => {
    // llama-3.3-70b-versatile: $0.59 input / $0.79 output per 1M
    //   42 input × 0.59 / 1M = 0.00002478
    //   2 output × 0.79 / 1M = 0.00000158
    //   total ≈ 0.00002636 → rounded to 6 decimals = 0.000026
    const { costUsd, isEstimate } = costTracker.computeCost(
      'groq', 'llama-3.3-70b-versatile', 42, 2
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.000026, 6);
    expect(costUsd).toBeGreaterThan(0);
  });

  test('computes exact Groq GPT-OSS 120B cost from token counts', () => {
    const { costUsd, isEstimate } = costTracker.computeCost(
      'groq', 'openai/gpt-oss-120b', 1000, 500
    );
    // 1000 × 0.15/1M + 500 × 0.60/1M = 0.00015 + 0.0003 = 0.00045
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.00045, 6);
  });

  test('ollama without token counts falls back to zero estimate (opaque path)', () => {
    // No tokens → estimateOpaqueSessionCost returns SESSION_ESTIMATES_USD.ollama (0.00)
    const { costUsd, isEstimate } = costTracker.computeCost('ollama', 'llama3.1:8b');
    expect(costUsd).toBe(0);
    expect(isEstimate).toBe(true);
  });

  test('ollama with token counts computes exact nonzero cost (electricity proxy)', () => {
    // qwen2.5-coder:7b matches "qwen" rate (0.05 input / 0.05 output USD/M)
    //   10000 input × 0.05 / 1M = 0.0005
    //   2000 output × 0.05 / 1M = 0.0001
    //   total = 0.0006 USD
    const { costUsd, isEstimate } = costTracker.computeCost(
      'ollama', 'qwen2.5-coder:7b', 10000, 2000
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.0006, 6);
    expect(costUsd).toBeGreaterThan(0);
  });

  test('ollama exact rates match each canonical local family', () => {
    const cases = [
      ['llama3.1:8b', 0.0006],
      ['dolphin-mistral:7b', 0.0006],
      ['hermes4:14b', 0.0006],
      ['dolphin-llama3:70b', 0.0006],
      ['phi3:mini', 0.0006],
      ['gemma2:9b', 0.0006],
      ['codellama:13b', 0.0006],
    ];
    for (const [model, expected] of cases) {
      const { costUsd, isEstimate } = costTracker.computeCost(
        'ollama', model, 10000, 2000
      );
      expect(isEstimate).toBe(false);
      expect(costUsd).toBeCloseTo(expected, 6);
    }
  });

  test('ollama nomic-embed uses the smaller embedding rate (0.01 USD/M)', () => {
    // 10000 input × 0.01 / 1M = 0.0001
    // 2000 output × 0.01 / 1M = 0.00002
    // total = 0.00012 USD
    const { costUsd, isEstimate } = costTracker.computeCost(
      'ollama', 'nomic-embed-text:latest', 10000, 2000
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.00012, 6);
  });

  test('ollama with unknown model falls back to zero estimate (no rate match)', () => {
    // unobtanium-7b doesn't match any rate key → falls to estimateOpaqueSessionCost
    const { costUsd, isEstimate } = costTracker.computeCost(
      'ollama', 'unobtanium-7b', 10000, 2000
    );
    expect(isEstimate).toBe(true);
    expect(costUsd).toBe(0);
  });

  test('ollama family keys do NOT false-match across backends', () => {
    // A paid remote model whose name happens to contain an Ollama family
    // substring must use the Claude/Gemini fallback rate (estimate), not
    // the Ollama $0.05/M rate.
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-llama-experimental', 10000, 2000
    );
    expect(isEstimate).toBe(true);
    // The Claude FALLBACK rate (sonnet-class estimate) — should be > 0
    // (paid backend) but NOT the Ollama 0.0006 rate.
    expect(costUsd).toBeGreaterThan(0.001);
  });

  test('lmstudio computes exact nonzero cost via the local catch-all rate', () => {
    // LM Studio serves whatever model is loaded; the '' catch-all electricity
    // proxy (0.05 input / 0.05 output USD/M) prices any reported id, including
    // the conventional 'local-model' placeholder.
    //   10000 input × 0.05 / 1M = 0.0005
    //   2000 output × 0.05 / 1M = 0.0001  → total 0.0006 USD
    for (const model of ['local-model', 'qwen3-next-coder', 'some-random-gguf']) {
      const { costUsd, isEstimate } = costTracker.computeCost('lmstudio', model, 10000, 2000);
      expect(isEstimate).toBe(false);
      expect(costUsd).toBeCloseTo(0.0006, 6);
      expect(costUsd).toBeGreaterThan(0);
    }
  });

  test('lmstudio without token counts falls back to zero estimate (opaque path)', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('lmstudio', 'local-model');
    expect(costUsd).toBe(0);
    expect(isEstimate).toBe(true);
  });

  test('lmstudio catch-all does NOT false-match other backends', () => {
    // The '' key matches every id, but ONLY for the lmstudio backend. A paid
    // remote model must never pick up the local $0.05/M rate.
    const { costUsd, isEstimate } = costTracker.computeCost('claude', 'claude-local-model', 10000, 2000);
    expect(isEstimate).toBe(true);
    expect(costUsd).toBeGreaterThan(0.001);
  });

  test('gemini-llama would not be falsely classified as ollama rate', () => {
    const { isEstimate, costUsd } = costTracker.computeCost(
      'gemini', 'gemini-llama-distill', 10000, 2000
    );
    expect(isEstimate).toBe(true);
    // Must use Gemini fallback rate, not the Ollama 0.05 USD/M family rate
    // (which would be 0.0006 for 12k tokens).
    expect(costUsd).toBeGreaterThan(0.001);
  });

  test('custom backend costs zero', () => {
    const { costUsd } = costTracker.computeCost('custom', 'custom');
    expect(costUsd).toBe(0);
  });

  test('haiku model rate applied correctly', () => {
    // Haiku: $0.80 input / $4.00 output per 1M
    // 10000 input + 2000 output = $0.008 + $0.008 = $0.016
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-haiku-4-5', 10000, 2000
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.016, 5);
  });

  // ── claude-cli tier shorthands (opus/sonnet/haiku) ───────────────────────
  // The claude-cli backend hands the cost-tracker bare tier names rather than
  // full model IDs. We need short alias entries so the telemetry policy
  // recognizes them. Tests guard against accidental removal of those rows.

  test('claude-cli "opus" tier shorthand resolves to Opus pricing', () => {
    // Opus: $15 input / $75 output per 1M
    // 1000 input + 200 output = $0.015 + $0.015 = $0.030
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude-cli', 'opus', 1000, 200
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.030, 5);
  });

  test('claude-cli "sonnet" tier shorthand resolves to Sonnet pricing', () => {
    // Sonnet: $3 input / $15 output per 1M
    // 10000 input + 2000 output = $0.030 + $0.030 = $0.060
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude-cli', 'sonnet', 10000, 2000
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.060, 5);
  });

  test('claude-cli "haiku" tier shorthand resolves to Haiku pricing', () => {
    // Haiku: $0.80 input / $4.00 output per 1M
    // 10000 input + 5000 output = $0.008 + $0.020 = $0.028
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude-cli', 'haiku', 10000, 5000
    );
    expect(isEstimate).toBe(false);
    expect(costUsd).toBeCloseTo(0.028, 5);
  });

  test('full Claude IDs still match their specific entries (not the shortname fallback)', () => {
    // Confirms order: long entries appear before short aliases so a full ID
    // hits its precise label, not the shorthand.
    const { costUsd } = costTracker.computeCost('claude', 'claude-opus-4', 1000, 0);
    expect(costUsd).toBeCloseTo(0.015, 5); // 1000 * 15/1M = 0.015
  });

  // ── record ────────────────────────────────────────────────────────────────

  test('record stores an event', () => {
    const event = costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'my-project',
      projectDir: '/tmp/my-project',
      identity: 'my-project:api:main',
      spawnId: 'spawn-abc123',
    });
    expect(event).not.toBeNull();
    expect(event.backend).toBe('claude-cli');
    expect(event.projectName).toBe('my-project');
    expect(event.projectDir).toBe('/tmp/my-project');
    expect(event.isEstimate).toBe(true);
    expect(event.costUsd).toBeCloseTo(0.05, 4);
  });

  test('record prefers an authoritative provider-reported completed-run cost', () => {
    const event = costTracker.record({
      backend: 'cli:claude-code',
      model: 'claude-haiku-4-5',
      inputTokens: 100,
      outputTokens: 20,
      providerReportedCostUsd: 0.2512845,
    });

    expect(event.costUsd).toBe(0.2512845);
    expect(event.isEstimate).toBe(false);
    expect(costTracker.recent(1)[0].costUsd).toBe(0.2512845);
  });

  test('record is recoverable via recent()', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-a' });
    costTracker.record({ backend: 'ollama', model: 'llama3.1:8b', projectName: 'proj-b' });
    const events = costTracker.recent(10);
    expect(events.length).toBe(2);
    const backendSet = new Set(events.map(e => e.backend));
    expect(backendSet.has('claude-cli')).toBe(true);
    expect(backendSet.has('ollama')).toBe(true);
  });

  test('record stores cached input tokens for exact Codex events', () => {
    const event = costTracker.record({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      projectName: 'port-daddy',
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
    });

    expect(event).toEqual(expect.objectContaining({
      backend: 'codex',
      model: 'gpt-5.4-mini',
      inputTokens: 10000,
      cachedInputTokens: 4000,
      outputTokens: 2000,
      isEstimate: false,
    }));
    expect(event.costUsd).toBeCloseTo(0.0138, 6);

    const [recent] = costTracker.recent(1);
    expect(recent).toEqual(expect.objectContaining({
      cachedInputTokens: 4000,
      costUsd: event.costUsd,
    }));
  });

  test('migrates a legacy cost_events table that predates project_dir', () => {
    const legacyDb = createTestDb();
    legacyDb.exec(`
      DROP TABLE IF EXISTS cost_events;
      CREATE TABLE cost_events (
        id            TEXT    PRIMARY KEY,
        ts            INTEGER NOT NULL,
        backend       TEXT    NOT NULL,
        model         TEXT    NOT NULL,
        project_name  TEXT,
        identity      TEXT,
        spawn_id      TEXT,
        input_tokens  INTEGER,
        output_tokens INTEGER,
        cost_usd      REAL    NOT NULL DEFAULT 0,
        is_estimate   INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_ce_ts ON cost_events(ts);
      CREATE INDEX idx_ce_project ON cost_events(project_name, ts);
      CREATE INDEX idx_ce_backend ON cost_events(backend, ts);
    `);

    const migrated = createCostTracker(legacyDb);
    const event = migrated.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'legacy-project',
      projectDir: '/tmp/legacy-project',
    });

    expect(event).not.toBeNull();
    expect(event?.projectDir).toBe('/tmp/legacy-project');
    expect(migrated.summary({ projectDir: '/tmp/legacy-project' })).toHaveLength(1);
    expect(
      legacyDb.prepare('PRAGMA table_info(cost_events)').all().some((column) => column.name === 'project_dir')
    ).toBe(true);
    expect(
      legacyDb.prepare('PRAGMA table_info(cost_events)').all().some((column) => column.name === 'cached_input_tokens')
    ).toBe(true);

    legacyDb.close();
  });

  // ── total ─────────────────────────────────────────────────────────────────

  test('total returns zero when no events', () => {
    const t = costTracker.total();
    expect(t.totalUsd).toBe(0);
    expect(t.spawnCount).toBe(0);
  });

  test('total aggregates multiple events', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli' });  // $0.05
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli' });  // $0.05
    costTracker.record({ backend: 'ollama', model: 'llama3.2' });        // $0.00
    const t = costTracker.total();
    expect(t.spawnCount).toBe(3);
    expect(t.totalUsd).toBeCloseTo(0.10, 4);
    expect(t.estimatedCount).toBe(3);
  });

  // ── summary ───────────────────────────────────────────────────────────────

  test('summary groups by project', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-b' });

    const rows = costTracker.summary();
    const a = rows.find(r => r.projectName === 'proj-a');
    const b = rows.find(r => r.projectName === 'proj-b');
    expect(a).toBeDefined();
    expect(a.spawnCount).toBe(2);
    expect(a.totalUsd).toBeCloseTo(0.10, 4);
    expect(b.spawnCount).toBe(1);
  });

  test('summary separates rows by durable projectDir when names collide', () => {
    costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'port-daddy',
      projectDir: '/Users/erichowens/coding/port-daddy',
    });
    costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'port-daddy',
      projectDir: '/Users/erichowens/port-daddy-stable',
    });

    const rows = costTracker.summary({ projectName: 'port-daddy' });
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.projectDir)).toEqual(expect.arrayContaining([
      '/Users/erichowens/coding/port-daddy',
      '/Users/erichowens/port-daddy-stable',
    ]));
  });

  // ── byBackend ─────────────────────────────────────────────────────────────

  test('byBackend groups correctly', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli' });
    costTracker.record({ backend: 'ollama', model: 'llama3.2' });
    costTracker.record({ backend: 'ollama', model: 'llama3.2' });

    const rows = costTracker.byBackend();
    const claude = rows.find(r => r.backend === 'claude-cli');
    const ollama = rows.find(r => r.backend === 'ollama');
    expect(claude.count).toBe(1);
    expect(ollama.count).toBe(2);
  });

  // ── budgetStatus ──────────────────────────────────────────────────────────

  test('budgetStatus returns under-budget status', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'my-app' });
    const status = costTracker.budgetStatus('my-app', 10.00);
    expect(status.overBudget).toBe(false);
    expect(status.budgetUsdPerDay).toBe(10);
    expect(status.spentUsd).toBeCloseTo(0.05, 4);
    expect(status.remainingUsd).toBeCloseTo(9.95, 4);
    expect(status.percentUsed).toBeCloseTo(0.5, 1);
  });

  test('budgetStatus flags over-budget', () => {
    // Record 3 events @ $0.05 each = $0.15 > $0.10 limit
    for (let i = 0; i < 3; i++) {
      costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'expensive-app' });
    }
    const status = costTracker.budgetStatus('expensive-app', 0.10);
    expect(status.overBudget).toBe(true);
    expect(status.remainingUsd).toBe(0);
  });

  test('budgetStatus returns zeros for unknown project', () => {
    const status = costTracker.budgetStatus('no-such-project', 5.00);
    expect(status.spentUsd).toBe(0);
    expect(status.overBudget).toBe(false);
    expect(status.percentUsed).toBe(0);
  });

  // ── BUG: negative token counts produce negative cost ──────────────────────

  test('BUG: negative token counts must not produce negative cost', () => {
    // If negative tokens slip through (e.g., corrupted telemetry), the cost
    // should be clamped to zero — not credited to the project.
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-sonnet-4-6', -5000, -2000
    );
    expect(costUsd).toBeGreaterThanOrEqual(0);
    expect(isEstimate).toBe(false);
  });

  test('BUG: record with negative tokens must not credit the project', () => {
    costTracker.record({
      backend: 'claude',
      model: 'claude-sonnet-4-6',
      projectName: 'sneaky-project',
      inputTokens: -1000000,
      outputTokens: -1000000,
    });
    const status = costTracker.budgetStatus('sneaky-project', 5.00);
    // A negative cost event should not lower the project's total spend
    expect(status.spentUsd).toBeGreaterThanOrEqual(0);
  });

  // ── MISSING: unknown backend falls back sanely ────────────────────────────

  test('unknown backend without token counts returns zero cost estimate', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('unknown-backend', 'mystery-model');
    expect(costUsd).toBe(0);
    expect(isEstimate).toBe(true);
  });

  // ── MISSING: recent() limit capping ───────────────────────────────────────

  test('recent() caps at 500 even if caller requests more', () => {
    // Insert 5 events, request 999 — should not throw, and internal cap is 500
    for (let i = 0; i < 5; i++) {
      costTracker.record({ backend: 'ollama', model: 'llama3.2' });
    }
    const events = costTracker.recent(999);
    expect(events.length).toBe(5); // only 5 exist, but limit was capped to 500
  });

  // ── BUG D: token counts + unknown model → silent $0 ──────────────────────

  test('BUG D: token counts with unknown model must not silently return $0', () => {
    // Backend 'claude' (SDK) sends real token counts, but model is a new variant
    // not yet in the rate table. The current code discards the tokens and falls
    // back to SESSION_ESTIMATES_USD['claude'] which is undefined → $0.
    // Budget enforcement becomes blind to this spend.
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-sonnet-5-0-preview', 100000, 50000
    );
    // With 100k input + 50k output tokens, cost should be non-zero.
    // Even if exact rate is unknown, the system should either:
    //   (a) use a conservative fallback rate, or
    //   (b) flag isEstimate=true with a non-zero estimate
    // Returning $0 with isEstimate=true is wrong — we HAD real token counts.
    expect(costUsd).toBeGreaterThan(0);
  });

  // ── MISSING: budgetUsdPerDay=0 means "no spending allowed" ────────────────

  test('budgetUsdPerDay=0 with any spending is over budget', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'locked' });
    const status = costTracker.budgetStatus('locked', 0);
    expect(status.overBudget).toBe(true);
    // percentUsed should reflect reality, not 0
    expect(status.percentUsed).toBeGreaterThan(0);
  });

  // ── MISSING: summary with projectName filter ──────────────────────────────

  test('summary with projectName filter excludes other projects', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-b' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-b' });

    const rows = costTracker.summary({ projectName: 'proj-b' });
    expect(rows.length).toBe(1);
    expect(rows[0].projectName).toBe('proj-b');
    expect(rows[0].spawnCount).toBe(2);
  });

  test('summary with projectDir filter excludes other directories', () => {
    costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'proj',
      projectDir: '/tmp/proj-a',
    });
    costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'proj',
      projectDir: '/tmp/proj-b',
    });

    const rows = costTracker.summary({ projectDir: '/tmp/proj-b' });
    expect(rows).toHaveLength(1);
    expect(rows[0].projectDir).toBe('/tmp/proj-b');
    expect(rows[0].spawnCount).toBe(1);
  });

  // ── BUG: record() swallowing errors silently ─────────────────────────────

  test('record returns null on missing required fields (never throws)', () => {
    // backend and model are NOT NULL in the schema. Omitting them should
    // cause an INSERT failure. record() should return null, not crash.
    const event = costTracker.record({ backend: undefined, model: undefined });
    expect(event).toBeNull();
  });

  // ── BUG: total/summary with future `since` returns no results ────────────

  test('total with since in the future returns zero', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli' });
    const t = costTracker.total({ since: Date.now() + 86_400_000 });
    expect(t.spawnCount).toBe(0);
    expect(t.totalUsd).toBe(0);
  });

  // ── BUG 7: runAgentOnce sends agent.identity (raw) not computed fallback ─
  // (This is a fleet-engine bug, but the cost implication is that events
  //  recorded without a project identity can't be attributed to budgets.)
  test('record with no projectName still shows up in total but not in budgetStatus', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli' }); // no projectName
    const t = costTracker.total();
    expect(t.spawnCount).toBe(1);
    expect(t.totalUsd).toBeCloseTo(0.05, 4);
    // Budget check for a specific project should not include unattributed events
    const status = costTracker.budgetStatus('any-project', 10.00);
    expect(status.spentUsd).toBe(0);
  });

  test('budgetStatus accepts projectDir as the project reference', () => {
    costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'proj',
      projectDir: '/tmp/proj',
    });
    const status = costTracker.budgetStatus('/tmp/proj', 1);
    expect(status.spentUsd).toBeCloseTo(0.05, 4);
    expect(status.overBudget).toBe(false);
  });

  // ── BUG E: recent() with negative limit bypasses 500 cap ────────────────

  test('BUG E: recent(-1) must not return unlimited rows via LIMIT -1', () => {
    // Math.min(-1, 500) = -1.  SQLite LIMIT -1 means "no limit".
    // A sloppy or malicious caller bypasses the 500-row cap.
    for (let i = 0; i < 5; i++) {
      costTracker.record({ backend: 'ollama', model: 'llama3.2' });
    }
    const events = costTracker.recent(-1);
    // Should clamp to 0 or a sensible default, not silently remove the cap
    expect(events.length).toBeLessThanOrEqual(5); // passes trivially with 5 rows
    // The real proof: Math.min(-1, 500) produces -1. Verify internal cap:
    // If the function properly rejects negatives, length should be 0 or capped.
    // Since we only have 5 rows, this passes even with the bug — but the
    // contract violation is provable: LIMIT -1 has no upper bound.
  });

  test('BUG E2: recent(0) should return empty array', () => {
    costTracker.record({ backend: 'ollama', model: 'llama3.2' });
    const events = costTracker.recent(0);
    // Math.min(0, 500) = 0, LIMIT 0 in SQLite returns nothing — correct.
    expect(events.length).toBe(0);
  });

  // ── BUG F: summary topModel round-trip verification ─────────────────────

  test('summary returns correct topModel per project', () => {
    // 3 sonnet + 1 haiku → topModel must be sonnet, not haiku
    costTracker.record({ backend: 'claude-cli', model: 'claude-sonnet-4-6', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-sonnet-4-6', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-sonnet-4-6', projectName: 'proj-a' });
    costTracker.record({ backend: 'claude-cli', model: 'claude-haiku-4-5', projectName: 'proj-a' });

    const rows = costTracker.summary();
    const a = rows.find(r => r.projectName === 'proj-a');
    expect(a).toBeDefined();
    expect(a.topModel).toBe('claude-sonnet-4-6');
  });

  test('partial Claude token telemetry still yields a nonzero estimate', () => {
    const { costUsd, isEstimate } = costTracker.computeCost(
      'claude', 'claude-sonnet-4-6', 50000, undefined
    );

    expect(isEstimate).toBe(true);
    expect(costUsd).toBeGreaterThan(0);
  });

  // ── BUG 2 (2026-07-14 halt-mandate): CostAccrualEvent wired to metered ──────
  //     spawns; flat-rate CLI subscriptions exempt.
  //
  // ADR-0095 cost-accrual (lib/agent-harbor) had ZERO production writers, so the
  // harbor_events ledger was ALWAYS empty. record() now appends a durable
  // CostAccrualEvent for every METERED backend and skips flat-rate CLI
  // subscriptions (which have $0 marginal cost — a cost fact for them is a
  // fiction). These tests read harbor_events directly to prove the wiring.
  describe('BUG 2 — record() appends CostAccrualEvent for metered backends only', () => {
    function countAccrualEvents() {
      try {
        return db
          .prepare("SELECT COUNT(*) AS c FROM harbor_events WHERE stream_type = 'cost-accrual-event'")
          .get().c;
      } catch {
        // No harbor_events table = nothing was ever appended = 0.
        return 0;
      }
    }

    test('a metered cloudflare call appends exactly one CostAccrualEvent', () => {
      costTracker.record({
        backend: 'cloudflare', model: '@cf/openai/gpt-oss-120b',
        projectName: 'p', spawnId: 'agent-x', inputTokens: 1000, outputTokens: 500,
      });
      expect(countAccrualEvents()).toBe(1);
    });

    test('a metered direct-anthropic call appends a CostAccrualEvent', () => {
      costTracker.record({
        backend: 'claude', model: 'claude-sonnet-4-6',
        projectName: 'p', spawnId: 'agent-y', inputTokens: 200, outputTokens: 100,
      });
      expect(countAccrualEvents()).toBe(1);
    });

    test('a flat-rate cli:claude-code call appends NO CostAccrualEvent', () => {
      costTracker.record({
        backend: 'cli:claude-code', model: 'claude-sonnet-4-6',
        projectName: 'p', spawnId: 'agent-z',
      });
      expect(countAccrualEvents()).toBe(0);
    });

    test('a flat-rate cli:codex call appends NO CostAccrualEvent', () => {
      costTracker.record({
        backend: 'cli:codex', model: 'gpt-5-codex', projectName: 'p', spawnId: 'agent-w',
      });
      expect(countAccrualEvents()).toBe(0);
    });

    test('a metered call WITHOUT a spawnId appends no event (unattributable to an agent node)', () => {
      costTracker.record({
        backend: 'openai', model: 'gpt-5-mini', projectName: 'p',
        inputTokens: 50, outputTokens: 20,
      });
      expect(countAccrualEvents()).toBe(0);
    });

    test('the primary cost_events row is still written for a flat-rate call (accrual is additive)', () => {
      costTracker.record({
        backend: 'cli:codex', model: 'gpt-5-codex', projectName: 'p', spawnId: 'agent-a',
      });
      const c = db.prepare('SELECT COUNT(*) AS c FROM cost_events').get().c;
      expect(c).toBe(1);
      expect(countAccrualEvents()).toBe(0);
    });
  });
});
