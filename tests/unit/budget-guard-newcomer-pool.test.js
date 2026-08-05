/**
 * Unit tests for the ADR-0040 spend choke in lib/budget-guard.ts.
 *
 * The load-bearing anti-Sybil property (design §4): minting N fresh newcomer ids
 * does NOT multiply the per-project budget, because all uncredentialed newcomers
 * share ONE per-project pool. Also proves an unknown/self-asserted id is
 * pool-floored (never admitted at a caller-supplied above-floor ceiling), and
 * that graduated souls get a soul-sourced individual ceiling.
 */

import { createTestDb } from '../setup-unit.js';
import { createBudgetGuard, utcDay } from '../../lib/budget-guard.js';
import { createActorSouls } from '../../lib/actor-souls.js';

const POOL_CEILING = 1.0;

function build() {
  const db = createTestDb();
  const souls = createActorSouls(db, {
    newcomerPoolCeilingUsd: POOL_CEILING,
    graduationThreshold: 3,
  });
  const guard = createBudgetGuard(db, {}, { souls });
  return { db, souls, guard };
}

describe('budget-guard ADR-0040 spend choke', () => {
  let db, souls, guard;
  beforeEach(() => { ({ db, souls, guard } = build()); });
  afterEach(() => db.close());

  test('minting N fresh newcomer ids does NOT multiply the per-project budget (Sybil-reset closed)', () => {
    // Mint 5 distinct newcomer souls — the launder attack: shed an id, mint fresh.
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const out = souls.register({ alias: `p:s:new${i}` });
      ids.push(out.actorId);
    }
    expect(new Set(ids).size).toBe(5);

    // Each charges $0.30 while ASKING for a high caller budget ($5/day). If the
    // ledger were per-id, aggregate headroom would be 5 × $5 = $25. Instead every
    // newcomer meters against the ONE shared pool (ceiling $1).
    let cancels = 0;
    for (const id of ids) {
      const d = guard.onCharge({ project: 'proj', agentId: id, budgetUsdPerDay: 5.0, usd: 0.30 });
      if (d.cancel) cancels++;
    }

    const day = utcDay();
    const poolSpend = souls.poolState('proj', day).spendUsd;
    expect(poolSpend).toBeCloseTo(1.5, 5);          // all 5 accumulate into one row
    expect(cancels).toBeGreaterThan(0);               // the pool ceiling bit (cancel fired)

    // A 6th fresh mint buys NO new budget: canSpawn is refused because the shared
    // pool is already over its ceiling — shedding+minting an id gains nothing.
    const sixth = souls.register({ alias: 'p:s:new6' });
    const spawn = guard.canSpawn({ project: 'proj', agentId: sixth.actorId, budgetUsdPerDay: 5.0, estimatedUsd: 0.1 });
    expect(spawn.ok).toBe(false);
    expect(spawn.reason).toBe('budget-exceeded');
    expect(spawn.budgetUsdPerDay).toBe(POOL_CEILING); // ceiling was soul-sourced, not caller-sourced
  });

  test('an unknown / self-asserted id is pool-floored — never admitted at an above-floor ceiling', () => {
    // No soul was ever minted for this string; the agent just asserts it.
    const forged = 'port-daddy:fleet:totally-made-up';
    const d = guard.canSpawn({ project: 'proj', agentId: forged, budgetUsdPerDay: 100.0, estimatedUsd: 5.0 });
    expect(d.ok).toBe(false);                        // 5.0 > pool ceiling 1.0
    expect(d.reason).toBe('budget-exceeded');
    expect(d.budgetUsdPerDay).toBe(POOL_CEILING);    // caller's $100 was floored to $1
  });

  test('caller may LOWER but never RAISE the newcomer ceiling above the floor', () => {
    const out = souls.register({ alias: 'p:s:lower' });
    // Caller asks for $0.40 (below the $1 pool ceiling) → the lower value governs.
    const d = guard.canSpawn({ project: 'proj', agentId: out.actorId, budgetUsdPerDay: 0.4, estimatedUsd: 0.5 });
    expect(d.ok).toBe(false);
    expect(d.budgetUsdPerDay).toBe(0.4);
  });

  test('a graduated soul gets a soul-sourced individual ceiling (leaves the pool)', () => {
    const out = souls.register({ alias: 'p:s:grad' });
    souls.recordCleanExit(out.actorId);
    souls.recordCleanExit(out.actorId);
    souls.recordCleanExit(out.actorId);
    expect(souls.classify(out.actorId)).toBe('graduated');

    // Graduated → individual ledger keyed on its actor_id, caller budget governs.
    const d = guard.onCharge({ project: 'proj', agentId: out.actorId, budgetUsdPerDay: 2.0, usd: 0.5 });
    expect(d.cancel).toBe(false);
    expect(d.throttle).toBe(false);
    expect(d.budgetUsdPerDay).toBe(2.0);

    // Its spend lands in the individual ledger, NOT the shared newcomer pool.
    const ledger = guard.getLedger('proj', out.actorId);
    expect(ledger).not.toBeNull();
    expect(ledger.spendUsd).toBeCloseTo(0.5, 5);
    expect(souls.poolState('proj', utcDay()).spendUsd).toBe(0); // pool untouched
  });

  test('operator-trusted souls also bypass the pool (individual ledger)', () => {
    const souls2 = createActorSouls(db, { operatorSecret: 'op-secret', newcomerPoolCeilingUsd: POOL_CEILING });
    const guard2 = createBudgetGuard(db, {}, { souls: souls2 });
    const out = souls2.register({ operatorToken: 'op-secret', alias: 'p:s:op' });
    expect(out.soulClass).toBe('operator');
    const d = guard2.onCharge({ project: 'proj2', agentId: out.actorId, budgetUsdPerDay: 3.0, usd: 1.0 });
    expect(d.cancel).toBe(false);
    expect(d.budgetUsdPerDay).toBe(3.0);
    expect(souls2.poolState('proj2', utcDay()).spendUsd).toBe(0);
  });
});

describe('budget-guard without a souls store is unchanged (backward compat)', () => {
  test('legacy per-agentId ledger path still admits at the caller budget', () => {
    const db = createTestDb();
    const guard = createBudgetGuard(db); // no souls dep
    const d = guard.canSpawn({ project: 'p', agentId: 'anything', budgetUsdPerDay: 100, estimatedUsd: 5 });
    expect(d.ok).toBe(true);
    expect(d.budgetUsdPerDay).toBe(100); // caller budget honored, no flooring
    db.close();
  });
});
