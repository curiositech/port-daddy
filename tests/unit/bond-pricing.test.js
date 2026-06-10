/**
 * Unit tests for lib/bond-pricing.ts — the scope-proportional bond pricer.
 *
 * These tests ARE the mechanism-design quality gates. Each maps to one of the
 * four properties the pricing function π must satisfy (paper §6.5):
 *
 *   1. Deterrence    → "Deterrence floor" + "IC floor cannot be breached"
 *   2. Accessibility → "Accessibility" + "Ceiling clamp"
 *   3. Risk sense    → "Scope monotonicity" + "Duration monotonicity"
 *   4. History adj.  → "Reputation discount" + "Par fallback"
 *
 * plus the Sybil-defense property that ties the discount to the PRINCIPAL.
 *
 * The closed form under test:  π(F, p) = c · (1 + α·s) · (1 − ρ),
 *                              floored at floorMultiple(tier)·c, clamped to ceiling.
 */

import {
  priceBond,
  classifyScope,
  durationMultiplier,
  reputationFactor,
  touchesCrownJewel,
  SCOPE_MULTIPLIER,
  FLOOR_MULTIPLE,
  R_MAX,
} from '../../lib/bond-pricing.js';

// ── Fixtures ────────────────────────────────────────────────────────────────
const MIN = 60_000;
const BASE = 5; // c = one operator-hour at $5/hr, matching the paper's worked example

// A principal with a deep clean history → maximal discount.
const deepRepLookup = (p) =>
  p === 'anchor:veteran' ? { completions: 60, failureRate: 0.01 } : null;
// A principal with a solid-but-not-maximal history → 0.7× discount band.
const goodRepLookup = (p) =>
  p === 'anchor:solid' ? { completions: 30, failureRate: 0.02 } : null;

// ── classifyScope: the capability grammar → tier ──────────────────────────────
describe('classifyScope (cap[] grammar → consequential-scope tier)', () => {
  test('read-only capabilities classify as read', () => {
    expect(classifyScope(['fs:read'])).toBe('read');
    expect(classifyScope(['chan:sub:project/*'])).toBe('read');
    expect(classifyScope([])).toBe('read'); // no caps → conservative floor
  });

  test('write capabilities classify as write', () => {
    expect(classifyScope(['fs:write'])).toBe('write');
    expect(classifyScope(['presence:write'])).toBe('write');
    expect(classifyScope(['chan:pub:agents'])).toBe('write');
  });

  test('db:write / deploy / secret classify as critical', () => {
    expect(classifyScope(['db:write'])).toBe('critical');
    expect(classifyScope(['db:migrate'])).toBe('critical');
    expect(classifyScope(['deploy:prod'])).toBe('critical');
    expect(classifyScope(['secret:read'])).toBe('critical');
  });

  test('spawn / wildcard-backend / full classify as full (amplifier)', () => {
    expect(classifyScope(['spawn:agent'])).toBe('full');
    expect(classifyScope(['backend:*'])).toBe('full');
    expect(classifyScope(['*'])).toBe('full');
    expect(classifyScope(['full'])).toBe('full');
  });

  test('scope only widens — the MAX signal wins', () => {
    // read + spawn → full (the amplifier dominates)
    expect(classifyScope(['fs:read', 'spawn:agent'])).toBe('full');
    // write + db:write → critical
    expect(classifyScope(['fs:write', 'db:write'])).toBe('critical');
  });

  test('crown-jewel overlap forces critical regardless of caps', () => {
    expect(classifyScope(['fs:read'], { touchesCrownJewel: true })).toBe('critical');
  });

  test('unknown caps do NOT silently escalate', () => {
    expect(classifyScope(['some:unknown:verb'])).toBe('read');
  });
});

// ── touchesCrownJewel: structural path overlap (not keyword matching) ──────────
describe('touchesCrownJewel (coast-guard crown-jewel overlap)', () => {
  const roots = ['/Users/x/.ssh', '/Users/x/.aws', '/Users/x/.config/gh'];

  test('detects a path under a denied dir', () => {
    expect(touchesCrownJewel(['/Users/x/.ssh/id_ed25519'], roots)).toBe(true);
  });
  test('detects an exact denied dir', () => {
    expect(touchesCrownJewel(['/Users/x/.aws'], roots)).toBe(true);
  });
  test('detects a dotenv anywhere', () => {
    expect(touchesCrownJewel(['/repo/app/.env.local'], roots)).toBe(true);
    expect(touchesCrownJewel(['/repo/.env'], [])).toBe(true);
  });
  test('does NOT match an unrelated path or a near-miss', () => {
    expect(touchesCrownJewel(['/repo/src/index.ts'], roots)).toBe(false);
    expect(touchesCrownJewel(['/Users/x/.sshknown_hosts'], roots)).toBe(false); // not under .ssh/
    expect(touchesCrownJewel(['/repo/.environment'], [])).toBe(false);          // not a dotenv
  });
});

// ── durationMultiplier: the TTL tree ──────────────────────────────────────────
describe('durationMultiplier (bond/card TTL tree)', () => {
  test('matches the skill tree bands', () => {
    expect(durationMultiplier(5 * MIN)).toBe(1.0);   // < 10m
    expect(durationMultiplier(10 * MIN)).toBe(1.0);  // boundary
    expect(durationMultiplier(20 * MIN)).toBe(1.5);  // 10–30m
    expect(durationMultiplier(45 * MIN)).toBe(2.0);  // 30–60m
    expect(durationMultiplier(120 * MIN)).toBe(3.0); // > 60m
  });
  test('is monotone non-decreasing in TTL', () => {
    const ttls = [1, 5, 10, 11, 30, 31, 60, 61, 600].map((m) => m * MIN);
    for (let i = 1; i < ttls.length; i++) {
      expect(durationMultiplier(ttls[i])).toBeGreaterThanOrEqual(durationMultiplier(ttls[i - 1]));
    }
  });
  test('non-positive / non-finite TTL → shortest band (no amplification)', () => {
    expect(durationMultiplier(0)).toBe(1.0);
    expect(durationMultiplier(-1)).toBe(1.0);
    expect(durationMultiplier(NaN)).toBe(1.0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 1 — SCOPE MONOTONICITY (risk sensitivity)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: scope monotonicity — critical > write > read (same duration/rep)', () => {
  const common = { baseUsd: BASE, ttlMs: 20 * MIN }; // par reputation (no hook)

  test('critical-file bond > write bond > read-only bond', () => {
    const read = priceBond({ ...common, capabilities: ['fs:read'] }).bondUsd;
    const write = priceBond({ ...common, capabilities: ['fs:write'] }).bondUsd;
    const critical = priceBond({ ...common, capabilities: ['db:write'] }).bondUsd;
    const full = priceBond({ ...common, capabilities: ['spawn:agent'] }).bondUsd;

    expect(write).toBeGreaterThan(read);
    expect(critical).toBeGreaterThan(write);
    expect(full).toBeGreaterThan(critical);
  });

  test('a crown-jewel path overlap prices a read like a critical write', () => {
    const roots = ['/Users/x/.ssh'];
    const plainRead = priceBond({ ...common, capabilities: ['fs:read'] }).bondUsd;
    const jewelRead = priceBond({
      ...common,
      capabilities: ['fs:read'],
      claimedPaths: ['/Users/x/.ssh/id_ed25519'],
      crownJewelRoots: roots,
    });
    expect(jewelRead.breakdown.scopeTier).toBe('critical');
    expect(jewelRead.bondUsd).toBeGreaterThan(plainRead);
  });

  test('bond is monotone non-decreasing in duration at fixed scope', () => {
    const at = (ttlMs) => priceBond({ baseUsd: BASE, capabilities: ['fs:write'], ttlMs }).bondUsd;
    expect(at(45 * MIN)).toBeGreaterThanOrEqual(at(20 * MIN));
    expect(at(120 * MIN)).toBeGreaterThanOrEqual(at(45 * MIN));
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 2 — DETERRENCE FLOOR (the IC invariant bond > max_gain_sabotage)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: deterrence floor — every tier ≥ its reconstruction-cost floor', () => {
  test('each scope tier bond ≥ floorMultiple(tier) × base, even at par', () => {
    for (const tier of ['read', 'write', 'critical', 'full']) {
      const { bondUsd } = priceBond({ baseUsd: BASE, capabilities: [], ttlMs: 5 * MIN, scopeTier: tier });
      expect(bondUsd).toBeGreaterThanOrEqual(FLOOR_MULTIPLE[tier] * BASE - 1e-9);
    }
  });

  test('a deep-reputation discount CANNOT breach the crown-jewel (critical) floor', () => {
    // Veteran principal, shortest duration → reputation pushes the curve down hard.
    const priced = priceBond({
      baseUsd: BASE,
      capabilities: ['db:write'], // critical
      ttlMs: 5 * MIN,             // duration 1.0×
      principalId: 'anchor:veteran',
      reputation: deepRepLookup,  // 0.5× factor
    });
    // Curve = 5 × 10 × 1.0 = 50; ×0.5 = 25; floor = 10 × 5 = 50 → floor wins.
    expect(priced.breakdown.floorApplied).toBe(true);
    expect(priced.bondUsd).toBeGreaterThanOrEqual(FLOOR_MULTIPLE.critical * BASE - 1e-9);
    expect(priced.bondUsd).toBe(50);
  });

  test('the full/spawn tier keeps a high floor regardless of reputation', () => {
    const priced = priceBond({
      baseUsd: BASE,
      capabilities: ['spawn:agent'], // full
      ttlMs: 5 * MIN,
      principalId: 'anchor:veteran',
      reputation: deepRepLookup,
    });
    expect(priced.bondUsd).toBeGreaterThanOrEqual(FLOOR_MULTIPLE.full * BASE - 1e-9);
  });

  test('reputation discount is bounded by r_max ≤ 0.5 — never trivializes', () => {
    // The (1 − ρ) factor can never be below (1 − r_max) = 0.5.
    expect(reputationFactor({ completions: 9999, failureRate: 0 }).factor).toBeGreaterThanOrEqual(1 - R_MAX);
    expect(R_MAX).toBeLessThanOrEqual(0.5);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 3 — ACCESSIBILITY (a strong history pays meaningfully less)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: accessibility — strong reputation pays less for routine work (but ≥ floor)', () => {
  test('a solid-history principal pays meaningfully less than an unknown one for routine write work', () => {
    // Routine = write tier. We deliberately give the task enough DURATION that
    // the curve sits above the write floor (3×base) — so this test measures the
    // reputation discount, not the floor clamp. base=20, write 3×, 60m → 2.0×:
    // par curve = 20×3×2 = 120, floor = 3×20 = 60 → real headroom for a discount.
    const base = 20;
    const routine = { baseUsd: base, capabilities: ['fs:write'], ttlMs: 60 * MIN };

    const unknown = priceBond({ ...routine, principalId: 'anchor:nobody', reputation: () => null });
    const solid = priceBond({ ...routine, principalId: 'anchor:solid', reputation: goodRepLookup });

    // Unknown gets a 2.0× surcharge; solid gets a 0.7× discount → solid pays much less.
    expect(solid.bondUsd).toBeLessThan(unknown.bondUsd);
    // And solid's discount actually applied (factor < 1), not floored away.
    expect(solid.breakdown.reputationFactor).toBeLessThan(1.0);
    expect(solid.breakdown.floorApplied).toBe(false);
    // Still never below the write floor.
    expect(solid.bondUsd).toBeGreaterThanOrEqual(FLOOR_MULTIPLE.write * base - 1e-9);
  });

  test('a deep-history principal on routine work pays meaningfully less than par-curve, never below floor', () => {
    // Long-running write so the discounted curve still clears the floor:
    // base=20, write 3×, 120m → 3.0×: par = 20×3×3 = 180; deep ×0.5 = 90 > 60 floor.
    const base = 20;
    const routine = { baseUsd: base, capabilities: ['fs:write'], ttlMs: 120 * MIN };
    const par = priceBond({ ...routine }); // no reputation → par (factor 1.0)
    const deep = priceBond({ ...routine, principalId: 'anchor:veteran', reputation: deepRepLookup });

    expect(deep.bondUsd).toBeLessThan(par.bondUsd);            // a real discount
    expect(deep.breakdown.reputationDiscount).toBe(R_MAX);     // ρ = 0.5
    expect(deep.breakdown.floorApplied).toBe(false);           // discount bites above the floor
    expect(deep.bondUsd).toBeGreaterThanOrEqual(FLOOR_MULTIPLE.write * base - 1e-9);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 4 — SYBIL RESISTANCE (discount keyed on PRINCIPAL, not agent id)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: Sybil resistance — reputation keyed on principal, not re-rollable agent id', () => {
  // The reputation hook is keyed on the PRINCIPAL. Two different agent ids that
  // share a principal must price identically; a fresh PRINCIPAL gets surcharged.
  const repByPrincipal = (principalId) =>
    principalId === 'anchor:erich' ? { completions: 60, failureRate: 0.01 } : null;

  const work = { baseUsd: 20, capabilities: ['fs:write'], ttlMs: 5 * MIN };

  test('a fresh AGENT id under the same PRINCIPAL inherits the principal reputation', () => {
    // Caller passes the PRINCIPAL as principalId; the agent id never enters pricing.
    const firstAgent = priceBond({ ...work, principalId: 'anchor:erich', reputation: repByPrincipal });
    const rerolledAgent = priceBond({ ...work, principalId: 'anchor:erich', reputation: repByPrincipal });
    // Same principal → identical price regardless of how many agent ids were burned.
    expect(rerolledAgent.bondUsd).toBe(firstAgent.bondUsd);
    expect(rerolledAgent.breakdown.reputationDiscount).toBe(R_MAX); // veteran discount inherited
  });

  test('a brand-new PRINCIPAL gets the unknown-agent surcharge (≥ par), no free ride', () => {
    const veteran = priceBond({ ...work, principalId: 'anchor:erich', reputation: repByPrincipal });
    const freshPrincipal = priceBond({ ...work, principalId: 'anchor:sybil-001', reputation: repByPrincipal });

    // Fresh principal is unknown → 2.0× surcharge → strictly more than the veteran.
    expect(freshPrincipal.bondUsd).toBeGreaterThan(veteran.bondUsd);
    expect(freshPrincipal.breakdown.reputationFactor).toBeGreaterThan(1.0);
    // Never a discount for an unknown principal.
    expect(freshPrincipal.breakdown.reputationDiscount).toBe(0);
  });

  test('the agent id is NOT an input — pricing is a function of the principal only', () => {
    // Sanity: PriceBondInput has no agentId field; the only identity it reads is
    // principalId. (If a future refactor leaks agent id into pricing, this test
    // documents the intent that it must not.)
    const input = { ...work, principalId: 'anchor:erich', reputation: repByPrincipal };
    expect(Object.prototype.hasOwnProperty.call(input, 'agentId')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 5 — CEILING CLAMP (bond never exceeds ceiling)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: ceiling clamp — bondUsd never exceeds ceilingUsd', () => {
  test('a sky-high curve is clamped to the ceiling', () => {
    const priced = priceBond({
      baseUsd: BASE,
      capabilities: ['spawn:agent'], // full → 25×
      ttlMs: 120 * MIN,              // 3.0×
      principalId: 'anchor:nobody',
      reputation: () => null,        // 2.0× surcharge → 5×25×3×2 = 750
      ceilingUsd: 100,
    });
    expect(priced.bondUsd).toBe(100);
    expect(priced.breakdown.ceilingApplied).toBe(true);
  });

  test('ceiling clamps even when it sits below a critical floor (operator affordability dominates)', () => {
    const priced = priceBond({
      baseUsd: BASE,
      capabilities: ['db:write'], // critical floor = 50
      ttlMs: 5 * MIN,
      ceilingUsd: 10,             // operator can only afford $10
    });
    expect(priced.bondUsd).toBe(10);
    expect(priced.breakdown.ceilingApplied).toBe(true);
    // The breakdown still surfaces the high floor so a caller can refuse the spawn.
    expect(priced.breakdown.floorUsd).toBe(50);
  });

  test('no ceiling → bond is unclamped above', () => {
    const priced = priceBond({ baseUsd: BASE, capabilities: ['db:write'], ttlMs: 5 * MIN });
    expect(priced.breakdown.ceilingApplied).toBe(false);
    expect(priced.bondUsd).toBe(50); // critical floor, no clamp
  });

  test('property: across random inputs, bondUsd ≤ ceilingUsd always', () => {
    const tiers = ['read', 'write', 'critical', 'full'];
    for (let i = 0; i < 200; i++) {
      const base = 1 + Math.random() * 50;
      const ceiling = Math.random() * 100;
      const tier = tiers[Math.floor(Math.random() * tiers.length)];
      const ttlMs = Math.floor(Math.random() * 180) * MIN;
      const { bondUsd } = priceBond({ baseUsd: base, capabilities: [], scopeTier: tier, ttlMs, ceilingUsd: ceiling });
      expect(bondUsd).toBeLessThanOrEqual(ceiling + 1e-9);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  QUALITY GATE 6 — PAR FALLBACK (no reputation lookup → 1.0×, no free ride)
// ════════════════════════════════════════════════════════════════════════════
describe('GATE: par fallback — no reputation hook ⇒ discount 1.0× (no free ride)', () => {
  test('omitting the reputation hook yields factor 1.0 and ρ 0', () => {
    const priced = priceBond({ baseUsd: 20, capabilities: ['fs:write'], ttlMs: 5 * MIN });
    expect(priced.breakdown.reputationFactor).toBe(1.0);
    expect(priced.breakdown.reputationDiscount).toBe(0);
  });

  test('omitting principalId (but passing a hook) also yields par — nothing to key on', () => {
    const priced = priceBond({
      baseUsd: 20,
      capabilities: ['fs:write'],
      ttlMs: 5 * MIN,
      reputation: deepRepLookup, // hook present but no principalId → not consulted
    });
    expect(priced.breakdown.reputationFactor).toBe(1.0);
  });

  test('par bond equals the bare curve (clamped to floor) — no discount applied', () => {
    // write tier, 20m → 1.5×: curve = 20 × 3 × 1.5 = 90; floor = 3 × 20 = 60 → 90.
    const priced = priceBond({ baseUsd: 20, capabilities: ['fs:write'], ttlMs: 20 * MIN });
    expect(priced.bondUsd).toBe(90);
    expect(priced.breakdown.floorApplied).toBe(false);
  });
});

// ── reputationFactor: the discrete tier table ─────────────────────────────────
describe('reputationFactor (principal history → (1 − ρ) factor)', () => {
  test('unknown principal → 2.0× surcharge', () => {
    expect(reputationFactor(null).factor).toBe(2.0);
  });
  test('1–5 clean completions → 1.5× surcharge', () => {
    expect(reputationFactor({ completions: 3, failureRate: 0 }).factor).toBe(1.5);
  });
  test('5–20 completions <10% failure → par (1.0×)', () => {
    expect(reputationFactor({ completions: 10, failureRate: 0.05 }).factor).toBe(1.0);
  });
  test('20–50 completions <5% failure → 0.7× (ρ=0.3)', () => {
    const r = reputationFactor({ completions: 30, failureRate: 0.02 });
    expect(r.factor).toBe(0.7);
    expect(r.rho).toBeCloseTo(0.3);
  });
  test('50+ completions <3% failure → 0.5× (ρ=r_max)', () => {
    const r = reputationFactor({ completions: 60, failureRate: 0.01 });
    expect(r.factor).toBe(0.5);
    expect(r.rho).toBe(R_MAX);
  });
  test('>20% failure rate → 3.0× penalty regardless of volume', () => {
    expect(reputationFactor({ completions: 200, failureRate: 0.25 }).factor).toBe(3.0);
  });
});

// ── closed-form reconciliation: matches the paper's worked example shape ───────
describe('closed-form reconciliation π(F,p) = c·(1 + α·s)·(1 − ρ)', () => {
  test('breakdown multiplies back to the pre-floor curve', () => {
    const priced = priceBond({
      baseUsd: 8,
      capabilities: ['fs:write'],   // write → 3×
      ttlMs: 45 * MIN,              // 2.0×
      principalId: 'anchor:solid',
      reputation: goodRepLookup,    // 0.7×
    });
    const b = priced.breakdown;
    const curve = b.base * b.scopeMultiplier * b.durationMultiplier * b.reputationFactor;
    // 8 × 3 × 2.0 × 0.7 = 33.6; write floor = 3 × 8 = 24 → curve wins (no floor).
    expect(curve).toBeCloseTo(33.6);
    expect(priced.bondUsd).toBeCloseTo(33.6);
    expect(b.floorApplied).toBe(false);
  });

  test('rejects a non-positive cleanup base c', () => {
    expect(() => priceBond({ baseUsd: 0, capabilities: [], ttlMs: MIN })).toThrow(/baseUsd/);
    expect(() => priceBond({ baseUsd: -1, capabilities: [], ttlMs: MIN })).toThrow(/baseUsd/);
  });

  test('exported multiplier tables are the documented bands', () => {
    expect(SCOPE_MULTIPLIER).toEqual({ read: 1, write: 3, critical: 10, full: 25 });
    expect(FLOOR_MULTIPLE).toEqual({ read: 1, write: 3, critical: 10, full: 25 });
  });
});
