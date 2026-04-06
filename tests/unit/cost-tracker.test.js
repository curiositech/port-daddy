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

  test('ollama costs zero', () => {
    const { costUsd, isEstimate } = costTracker.computeCost('ollama', 'llama3.2:8b');
    expect(costUsd).toBe(0);
    expect(isEstimate).toBe(true);
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

  // ── record ────────────────────────────────────────────────────────────────

  test('record stores an event', () => {
    const event = costTracker.record({
      backend: 'claude-cli',
      model: 'claude-cli',
      projectName: 'my-project',
      identity: 'my-project:api:main',
      spawnId: 'spawn-abc123',
    });
    expect(event).not.toBeNull();
    expect(event.backend).toBe('claude-cli');
    expect(event.projectName).toBe('my-project');
    expect(event.isEstimate).toBe(true);
    expect(event.costUsd).toBeCloseTo(0.05, 4);
  });

  test('record is recoverable via recent()', () => {
    costTracker.record({ backend: 'claude-cli', model: 'claude-cli', projectName: 'proj-a' });
    costTracker.record({ backend: 'ollama', model: 'llama3.2:8b', projectName: 'proj-b' });
    const events = costTracker.recent(10);
    expect(events.length).toBe(2);
    const backendSet = new Set(events.map(e => e.backend));
    expect(backendSet.has('claude-cli')).toBe(true);
    expect(backendSet.has('ollama')).toBe(true);
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
});
