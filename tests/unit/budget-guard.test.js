/**
 * Unit tests for lib/budget-guard.ts
 *
 * Covers:
 *   - canSpawn pre-flight admits/rejects correctly
 *   - onCharge throttles at 80%, cancels at 100%
 *   - cancel_armed_at is set idempotently
 *   - UTC day bucketing (we stub Date.now via spyOn)
 *   - edge cases: budgetUsdPerDay=0 blocks everything; NaN usd clamps to 0
 */

import { createTestDb } from '../setup-unit.js';
import { createBudgetGuard, utcDay } from '../../lib/budget-guard.js';

describe('BudgetGuard', () => {
  let db;
  let guard;

  beforeEach(() => {
    db = createTestDb();
    guard = createBudgetGuard(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── utcDay ─────────────────────────────────────────────────────────────

  test('utcDay returns YYYY-MM-DD for a given epoch', () => {
    // 2026-01-15T23:30:00Z
    const t = Date.UTC(2026, 0, 15, 23, 30, 0);
    expect(utcDay(t)).toBe('2026-01-15');
  });

  // ─── canSpawn ───────────────────────────────────────────────────────────

  test('canSpawn admits when spent + estimated < budget', () => {
    const d = guard.canSpawn({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, estimatedUsd: 0.20,
    });
    expect(d.ok).toBe(true);
    expect(d.spentTodayUsd).toBe(0);
  });

  test('canSpawn refuses when estimated alone exceeds budget', () => {
    const d = guard.canSpawn({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, estimatedUsd: 1.50,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('budget-exceeded');
  });

  test('canSpawn refuses when budgetUsdPerDay = 0', () => {
    const d = guard.canSpawn({ project: 'p', agentId: 'a', budgetUsdPerDay: 0 });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('budget-exceeded');
  });

  test('canSpawn refuses when cancellation is armed', () => {
    // Force a cancel first.
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 0.10, usd: 0.15 });
    const d = guard.canSpawn({
      project: 'p', agentId: 'a', budgetUsdPerDay: 0.10, estimatedUsd: 0.01,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('cancellation-armed');
  });

  test('migrates the legacy armed column without losing safety state', () => {
    db.close();
    db = createTestDb();
    db.prepare(`CREATE TABLE budget_ledger (
      project TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      day TEXT NOT NULL,
      spend_usd REAL NOT NULL DEFAULT 0,
      kill_armed_at INTEGER,
      PRIMARY KEY (project, agent_id, day)
    )`).run();
    db.prepare('INSERT INTO budget_ledger VALUES (?, ?, ?, ?, ?)')
      .run('p', 'legacy-agent', utcDay(), 0.75, 123456789);

    guard = createBudgetGuard(db);

    const columns = db.prepare('PRAGMA table_info(budget_ledger)').all().map((column) => column.name);
    expect(columns).toContain('cancel_armed_at');
    expect(columns).not.toContain('kill_armed_at');
    expect(guard.getLedger('p', 'legacy-agent').cancellationArmedAt).toBe(123456789);
    expect(guard.canSpawn({ project: 'p', agentId: 'legacy-agent', budgetUsdPerDay: 1 }).reason)
      .toBe('cancellation-armed');
  });

  // ─── onCharge thresholds ────────────────────────────────────────────────

  test('onCharge stays silent under 80%', () => {
    const d = guard.onCharge({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.50,
    });
    expect(d.cancel).toBe(false);
    expect(d.throttle).toBe(false);
    expect(d.spentTodayUsd).toBeCloseTo(0.50, 6);
  });

  test('onCharge throttles at ≥80% and < 100%', () => {
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.70 });
    const d = guard.onCharge({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.15,
    });
    expect(d.spentTodayUsd).toBeCloseTo(0.85, 6);
    expect(d.throttle).toBe(true);
    expect(d.cancel).toBe(false);
  });

  test('onCharge cancels at ≥100%', () => {
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.70 });
    const d = guard.onCharge({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1.00, usd: 0.40,
    });
    expect(d.spentTodayUsd).toBeCloseTo(1.10, 6);
    expect(d.cancel).toBe(true);
    expect(d.throttle).toBe(true);
    expect(d.reason).toBe('budget-exceeded');
  });

  test('onCharge with usd=0 is a no-op for spend but still decides based on current state', () => {
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: 0.85 });
    const d = guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: 0 });
    expect(d.spentTodayUsd).toBeCloseTo(0.85, 6);
    expect(d.throttle).toBe(true);
  });

  test('onCharge with NaN usd treats it as zero', () => {
    const d = guard.onCharge({
      project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: NaN,
    });
    expect(d.spentTodayUsd).toBe(0);
  });

  // ─── cancel_armed_at idempotence ──────────────────────────────────────────

  test('cancel_armed_at is set once per day, not re-armed on later breaches', () => {
    // First breach arms.
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 0.10, usd: 0.20 });
    const first = guard.getLedger('p', 'a');
    expect(first.cancellationArmedAt).not.toBeNull();
    const armedAt = first.cancellationArmedAt;

    // Second breach should NOT change the timestamp.
    // Wait a tick to ensure Date.now() would differ if we re-armed.
    const later = armedAt + 100;
    const origNow = Date.now;
    global.Date.now = () => later;
    try {
      guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 0.10, usd: 0.05 });
      const second = guard.getLedger('p', 'a');
      expect(second.cancellationArmedAt).toBe(armedAt);
    } finally {
      global.Date.now = origNow;
    }
  });

  // ─── Ledger / isolation ─────────────────────────────────────────────────

  test('spend is isolated per (project, agent, day)', () => {
    guard.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: 0.30 });
    guard.onCharge({ project: 'p', agentId: 'b', budgetUsdPerDay: 1, usd: 0.50 });
    guard.onCharge({ project: 'q', agentId: 'a', budgetUsdPerDay: 1, usd: 0.70 });

    expect(guard.getSpendToday('p', 'a')).toBeCloseTo(0.30, 6);
    expect(guard.getSpendToday('p', 'b')).toBeCloseTo(0.50, 6);
    expect(guard.getSpendToday('q', 'a')).toBeCloseTo(0.70, 6);
  });

  test('listToday returns all project agents sorted by spend desc', () => {
    guard.onCharge({ project: 'p', agentId: 'cheap', budgetUsdPerDay: 1, usd: 0.10 });
    guard.onCharge({ project: 'p', agentId: 'mid', budgetUsdPerDay: 1, usd: 0.40 });
    guard.onCharge({ project: 'p', agentId: 'pig', budgetUsdPerDay: 1, usd: 0.90 });
    const rows = guard.listToday('p');
    expect(rows.map((r) => r.agentId)).toEqual(['pig', 'mid', 'cheap']);
  });

  // ─── Custom thresholds ──────────────────────────────────────────────────

  test('custom throttle/cancel thresholds are honored', () => {
    db.close();
    db = createTestDb();
    const strict = createBudgetGuard(db, { throttleThreshold: 0.50, cancellationThreshold: 0.75 });

    const d1 = strict.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: 0.60 });
    expect(d1.throttle).toBe(true);
    expect(d1.cancel).toBe(false);

    const d2 = strict.onCharge({ project: 'p', agentId: 'a', budgetUsdPerDay: 1, usd: 0.20 });
    expect(d2.spentTodayUsd).toBeCloseTo(0.80, 6);
    expect(d2.cancel).toBe(true);
  });
});
