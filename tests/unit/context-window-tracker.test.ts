import { describe, it, expect, beforeEach } from '@jest/globals';
import { initDatabase } from '../../lib/db.js';
import {
  createContextWindowTracker,
  getEffectiveContextWindow,
  computePressureLevel,
  EFFECTIVE_CONTEXT_WINDOWS,
} from '../../lib/context-window-tracker.js';

describe('getEffectiveContextWindow', () => {
  it('resolves claude-sonnet-4-6 via claude-sonnet-4 prefix', () => {
    expect(getEffectiveContextWindow('claude-sonnet-4-6')).toBe(120_000);
  });

  it('resolves claude-opus-4-8', () => {
    expect(getEffectiveContextWindow('claude-opus-4-8')).toBe(120_000);
  });

  it('resolves claude-haiku-4-5-20251001', () => {
    expect(getEffectiveContextWindow('claude-haiku-4-5-20251001')).toBe(120_000);
  });

  it('resolves gemini-2.5-pro to 600k', () => {
    expect(getEffectiveContextWindow('gemini-2.5-pro')).toBe(600_000);
  });

  it('resolves gpt-4o-mini to 9.6k', () => {
    expect(getEffectiveContextWindow('gpt-4o-mini')).toBe(9_600);
  });

  it('falls back to 60k for unknown model', () => {
    expect(getEffectiveContextWindow('totally-made-up-model-v99')).toBe(60_000);
  });

  it('is case-insensitive', () => {
    expect(getEffectiveContextWindow('Claude-Sonnet-4-6')).toBe(120_000);
  });

  it('all effective windows are <= 60% of a round million', () => {
    // Rough sanity: none should exceed the 1M ceiling * 60%
    for (const val of Object.values(EFFECTIVE_CONTEXT_WINDOWS)) {
      expect(val).toBeLessThanOrEqual(600_000);
    }
  });
});

describe('computePressureLevel', () => {
  it('ok below 50%', () => {
    expect(computePressureLevel(0)).toBe('ok');
    expect(computePressureLevel(0.49)).toBe('ok');
  });

  it('warn at 50%', () => {
    expect(computePressureLevel(0.5)).toBe('warn');
    expect(computePressureLevel(0.69)).toBe('warn');
  });

  it('critical at 70%', () => {
    expect(computePressureLevel(0.7)).toBe('critical');
    expect(computePressureLevel(1.0)).toBe('critical');
  });
});

describe('createContextWindowTracker', () => {
  let db: ReturnType<typeof initDatabase>;
  let tracker: ReturnType<typeof createContextWindowTracker>;

  beforeEach(() => {
    db = initDatabase({ inMemory: true });
    tracker = createContextWindowTracker(db);
  });

  describe('upsertContextHealth', () => {
    it('creates a new health row', () => {
      const health = tracker.upsertContextHealth('agent-1', 'claude-sonnet-4-6', 10_000);
      expect(health.agentId).toBe('agent-1');
      expect(health.effectiveMax).toBe(120_000);
      expect(health.usedPct).toBeCloseTo(10_000 / 120_000);
      expect(health.pressureLevel).toBe('ok');
      expect(health.remaining).toBe(110_000);
    });

    it('upserts on repeat call', () => {
      tracker.upsertContextHealth('agent-1', 'claude-sonnet-4-6', 10_000);
      const h2 = tracker.upsertContextHealth('agent-1', 'claude-sonnet-4-6', 70_000);
      expect(h2.tokensUsed).toBe(70_000);
      // 70k / 120k = 0.583 → warn (threshold is 70% for critical)
      expect(h2.pressureLevel).toBe('warn');
    });

    it('sets critical pressure at ≥70% of effective', () => {
      const h = tracker.upsertContextHealth('agent-1', 'claude-sonnet-4-6', 84_001);
      // 84001 / 120000 = 0.7000... → critical
      expect(h.pressureLevel).toBe('critical');
    });

    it('remaining is zero when fully consumed', () => {
      const h = tracker.upsertContextHealth('agent-1', 'claude-sonnet-4-6', 200_000);
      expect(h.remaining).toBe(0);
    });
  });

  describe('getContextHealth', () => {
    it('returns null for unknown agent', () => {
      expect(tracker.getContextHealth('ghost')).toBeNull();
    });

    it('round-trips through DB', () => {
      tracker.upsertContextHealth('agent-2', 'gemini-2.5-flash', 50_000);
      const h = tracker.getContextHealth('agent-2');
      expect(h).not.toBeNull();
      expect(h!.model).toBe('gemini-2.5-flash');
      expect(h!.effectiveMax).toBe(600_000);
    });
  });

  describe('getSwarmContextSummary', () => {
    it('returns all agents sorted by pressure', () => {
      tracker.upsertContextHealth('a1', 'claude-sonnet-4-6', 84_001); // critical
      tracker.upsertContextHealth('a2', 'claude-sonnet-4-6', 60_001); // warn
      tracker.upsertContextHealth('a3', 'claude-sonnet-4-6', 1_000);  // ok
      const summary = tracker.getSwarmContextSummary();
      expect(summary.length).toBe(3);
      expect(summary[0].agentId).toBe('a1'); // highest usedPct first
    });

    it('filters by project prefix', () => {
      tracker.upsertContextHealth('port-daddy:agent', 'claude-sonnet-4-6', 1_000);
      tracker.upsertContextHealth('other:agent', 'claude-sonnet-4-6', 1_000);
      const pd = tracker.getSwarmContextSummary('port-daddy');
      expect(pd.length).toBe(1);
      expect(pd[0].agentId).toBe('port-daddy:agent');
    });
  });

  describe('appendTaskLedger / getTaskLedger', () => {
    it('appends a row and retrieves it', () => {
      const row = tracker.appendTaskLedger({
        agentId: 'agent-1', model: 'claude-sonnet-4-6',
        inputTokens: 5_000, outputTokens: 1_000,
        costUsd: 0.012, costIsEstimate: false,
      });
      expect(row.totalTokens).toBe(6_000);
      expect(row.effectiveContextMax).toBe(120_000);
      expect(row.costIsEstimate).toBe(false);

      const rows = tracker.getTaskLedger('agent-1');
      expect(rows.length).toBe(1);
      expect(rows[0].id).toBe(row.id);
    });

    it('records sortieId and sessionId', () => {
      tracker.appendTaskLedger({
        agentId: 'a', model: 'claude-sonnet-4-6',
        inputTokens: 1, outputTokens: 1, costUsd: 0,
        sortieId: 'sortie-abc', sessionId: 'sess-xyz',
      });
      const rows = tracker.getTaskLedger('a');
      expect(rows[0].sortieId).toBe('sortie-abc');
      expect(rows[0].sessionId).toBe('sess-xyz');
    });

    it('filters by since date', () => {
      // past record: fake recorded_at by inserting directly
      tracker.appendTaskLedger({
        agentId: 'a', model: 'claude-haiku-4-5', inputTokens: 1, outputTokens: 1, costUsd: 0,
      });
      const futureDate = new Date(Date.now() + 10_000).toISOString();
      const rows = tracker.getTaskLedger('a', futureDate);
      expect(rows.length).toBe(0);
    });

    it('updateLandedWork sets the landed_work field', () => {
      const row = tracker.appendTaskLedger({
        agentId: 'a', model: 'claude-sonnet-4-6', inputTokens: 1, outputTokens: 1, costUsd: 0,
      });
      tracker.updateLandedWork(row.id, 'pr:42');
      const updated = tracker.getTaskLedger('a')[0];
      expect(updated.landedWork).toBe('pr:42');
    });
  });

  describe('getDailyCostByAgent / getSwarmDailyCostUsd', () => {
    it('aggregates daily cost per agent', () => {
      tracker.appendTaskLedger({ agentId: 'a1', model: 'claude-sonnet-4-6', inputTokens: 1, outputTokens: 1, costUsd: 0.10 });
      tracker.appendTaskLedger({ agentId: 'a1', model: 'claude-sonnet-4-6', inputTokens: 1, outputTokens: 1, costUsd: 0.05 });
      tracker.appendTaskLedger({ agentId: 'a2', model: 'claude-sonnet-4-6', inputTokens: 1, outputTokens: 1, costUsd: 0.20 });

      const today = new Date().toISOString().slice(0, 10);
      const costs = tracker.getDailyCostByAgent(today);
      const a1 = costs.find(c => c.agentId === 'a1');
      expect(a1?.costUsd).toBeCloseTo(0.15);

      const total = tracker.getSwarmDailyCostUsd(today);
      expect(total).toBeCloseTo(0.35);
    });
  });
});
