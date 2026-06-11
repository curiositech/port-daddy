/**
 * Unit tests for the bond↔Coast-Guard scope-containment linkage — the
 * ×2-review-confirmed structural gap where the pricer prices a scope tier the
 * platform may not actually contain.
 *
 * Two units under test:
 *   1. lib/coast-guard.ts `enforcedContainmentTier(report)` — maps what the
 *      Coast Guard ACTUALLY bounds on this machine today (an OS sandbox +
 *      crown-jewel read-deny + egress meter + secret broker, plus PR #339's
 *      read-tier workdir write-deny) to a scope tier in bond-pricing.ts's
 *      vocabulary. The HONEST ceiling is MODEST: `'read'` when a sandbox is
 *      present (read/exfil/spend bounded + read-tier write-confined, but
 *      write/critical/full stay `unrestricted` under scopeTierWritePolicy — no
 *      write-deny, no force-push gate), and `null` (DEGRADED) when there is no
 *      sandbox or the guard is off.
 *   2. lib/bond-pricing.ts `breakdown.uncontainedScope` — true iff the PRICED
 *      tier exceeds the ENFORCED tier (the bond underwrites a blast radius the
 *      runtime cannot structurally prevent). ADVISORY only: no escrow change, no
 *      bondUsd change, no refusal. Absent Coast Guard report → stays false (no
 *      fabrication).
 *
 * These tests are the quality gate on the HONESTY of the mapping: they pin the
 * enforced tier to `'read'`/`null` (never `'write'`+), so a future change that
 * silently overclaims containment — or makes `uncontainedScope` go quiet on a
 * gap that is still open — fails here.
 */

import { enforcedContainmentTier } from '../../lib/coast-guard.js';
import { priceBond, TIER_RANK, pricedBondLogLines } from '../../lib/bond-pricing.js';

// ── Fixtures: representative CoastGuardStatusReports ──────────────────────────
const MIN = 60_000;
const BASE = 5;

/** A fully-armed Coast Guard with a live OS sandbox (the common macOS/Linux case). */
function armedReport(overrides = {}) {
  return {
    onByDefault: true,
    platform: 'darwin',
    mechanism: 'seatbelt',
    confinementAvailable: true,
    protects: {
      dotenvUnderHome: true,
      deniedDirs: ['/home/test/.ssh', '/home/test/.aws', '/home/test/.port-daddy-env'],
    },
    egressMetering: true,
    secretBroker: true,
    ...overrides,
  };
}

// ── enforcedContainmentTier: the honest posture → tier mapping ────────────────

describe('enforcedContainmentTier — what the Coast Guard ACTUALLY contains today', () => {
  test('sandbox + crown-jewels + egress + broker → MODEST ceiling "read" (NOT write+)', () => {
    // The honest ceiling: the read/exfil/spend axis is bounded + read-tier write
    // confinement; nothing stronger. Pins the overclaim line — exactly 'read'.
    const tier = enforcedContainmentTier(armedReport());
    expect(tier).toBe('read');
    expect(tier).not.toBe('write');
    expect(tier).not.toBe('critical');
    expect(tier).not.toBe('full');
  });

  test('no OS sandbox (mechanism "none") → DEGRADED (null), not "read"', () => {
    // Without a sandbox even crown-jewel reads + the read-tier write-deny are
    // unconfined → no containment tier at all. null (not 'read') so a caller
    // never treats degraded as read.
    const tier = enforcedContainmentTier(
      armedReport({ mechanism: 'none', confinementAvailable: false }),
    );
    expect(tier).toBeNull();
  });

  test('Linux landlock-helper sandbox is honored the same as seatbelt → "read"', () => {
    const tier = enforcedContainmentTier(
      armedReport({ platform: 'linux', mechanism: 'landlock-helper' }),
    );
    expect(tier).toBe('read');
  });

  test('guard disabled (onByDefault false) → DEGRADED (null) even with a sandbox', () => {
    const tier = enforcedContainmentTier(armedReport({ onByDefault: false }));
    expect(tier).toBeNull();
  });

  test('sandbox present but a core bound missing → does NOT overclaim "read"', () => {
    // If egress metering, the broker, or the crown-jewel deny were somehow off,
    // we must NOT claim 'read' containment — fall back to degraded (null).
    expect(enforcedContainmentTier(armedReport({ egressMetering: false }))).toBeNull();
    expect(enforcedContainmentTier(armedReport({ secretBroker: false }))).toBeNull();
    expect(
      enforcedContainmentTier(
        armedReport({ protects: { dotenvUnderHome: false, deniedDirs: [] } }),
      ),
    ).toBeNull();
    expect(
      enforcedContainmentTier(
        armedReport({ protects: { dotenvUnderHome: true, deniedDirs: [] } }),
      ),
    ).toBeNull();
  });

  test('confinementAvailable false with a non-none mechanism → DEGRADED (defensive)', () => {
    // Inconsistent report (mechanism set but availability false): treat as
    // degraded rather than claim containment that may not be wired.
    const tier = enforcedContainmentTier(
      armedReport({ mechanism: 'seatbelt', confinementAvailable: false }),
    );
    expect(tier).toBeNull();
  });

  test('returned tier (when non-null) is always read — the modest honest ceiling', () => {
    // Sweep the mechanisms that count as "sandbox present": all map to read.
    for (const mechanism of ['seatbelt', 'landlock-helper', 'bwrap']) {
      expect(enforcedContainmentTier(armedReport({ mechanism }))).toBe('read');
    }
  });
});

// ── uncontainedScope: priced tier vs enforced tier ───────────────────────────

describe('breakdown.uncontainedScope — bond prices risk the platform cannot contain', () => {
  const armed = armedReport(); // enforced tier = 'read'

  test('priced "full" exceeds enforced "read" → uncontainedScope TRUE', () => {
    const { breakdown } = priceBond({
      baseUsd: BASE,
      capabilities: ['spawn:agent', 'backend:claude'], // → full (spawn amplifier)
      ttlMs: 5 * MIN,
      coastGuardReport: armed,
    });
    expect(breakdown.scopeTier).toBe('full');
    expect(breakdown.uncontainedScope).toBe(true);
  });

  test('priced "critical" exceeds enforced "read" → uncontainedScope TRUE', () => {
    const { breakdown } = priceBond({
      baseUsd: BASE,
      capabilities: ['db:write'], // → critical
      ttlMs: 5 * MIN,
      coastGuardReport: armed,
    });
    expect(breakdown.scopeTier).toBe('critical');
    expect(breakdown.uncontainedScope).toBe(true);
  });

  test('priced "write" exceeds enforced "read" → uncontainedScope TRUE', () => {
    const { breakdown } = priceBond({
      baseUsd: BASE,
      scopeTier: 'write',
      ttlMs: 5 * MIN,
      coastGuardReport: armed,
    });
    expect(breakdown.scopeTier).toBe('write');
    expect(breakdown.uncontainedScope).toBe(true);
  });

  test('priced "read" does NOT exceed enforced "read" → uncontainedScope FALSE', () => {
    const { breakdown } = priceBond({
      baseUsd: BASE,
      scopeTier: 'read',
      ttlMs: 5 * MIN,
      coastGuardReport: armed,
    });
    expect(breakdown.scopeTier).toBe('read');
    expect(breakdown.uncontainedScope).toBe(false);
  });

  test('DEGRADED posture (no sandbox) → ANY priced tier is uncontained, even "read"', () => {
    const degraded = armedReport({ mechanism: 'none', confinementAvailable: false });
    for (const tier of ['read', 'write', 'critical', 'full']) {
      const { breakdown } = priceBond({
        baseUsd: BASE,
        scopeTier: tier,
        ttlMs: 5 * MIN,
        coastGuardReport: degraded,
      });
      expect(breakdown.uncontainedScope).toBe(true);
    }
  });

  test('NO Coast Guard report supplied → uncontainedScope stays FALSE (no fabrication)', () => {
    // Absent posture: the pricer never invents a containment claim it cannot read.
    const { breakdown } = priceBond({
      baseUsd: BASE,
      capabilities: ['spawn:agent', 'backend:claude'], // would be uncontained IF a report were given
      ttlMs: 5 * MIN,
    });
    expect(breakdown.scopeTier).toBe('full');
    expect(breakdown.uncontainedScope).toBe(false);
  });

  test('uncontainedScope is purely advisory — it does not perturb bondUsd or other flags', () => {
    // Same inputs, with and without the report → identical bond + identical
    // floor/ceiling flags; ONLY uncontainedScope differs.
    const args = {
      baseUsd: BASE,
      capabilities: ['db:write'],
      ttlMs: 45 * MIN,
      ceilingUsd: 1000,
    };
    const without = priceBond(args);
    const with_ = priceBond({ ...args, coastGuardReport: armed });
    expect(with_.bondUsd).toBe(without.bondUsd);
    expect(with_.breakdown.floorUsd).toBe(without.breakdown.floorUsd);
    expect(with_.breakdown.floorApplied).toBe(without.breakdown.floorApplied);
    expect(with_.breakdown.ceilingApplied).toBe(without.breakdown.ceilingApplied);
    expect(with_.breakdown.belowFloor).toBe(without.breakdown.belowFloor);
    // Only the advisory containment flag flips.
    expect(without.breakdown.uncontainedScope).toBe(false);
    expect(with_.breakdown.uncontainedScope).toBe(true);
  });

  test('the realistic spawner case (spawn:agent + backend:<id> → full) flags under an armed guard', () => {
    // This mirrors lib/spawner.ts's live priceBond call exactly. Today EVERY
    // priced spawn enters as `full` (the spawn cap is an amplifier), while the
    // Coast Guard contains only `read` — so a supplied report flags it. This is
    // the honest gap size: ~100% of today's priced spawns are uncontained.
    const { breakdown } = priceBond({
      baseUsd: 0.01,
      capabilities: ['spawn:agent', 'backend:claude'],
      ttlMs: 300_000,
      coastGuardReport: armed,
    });
    expect(breakdown.scopeTier).toBe('full');
    expect(breakdown.uncontainedScope).toBe(true);
    // And the ranking that drives it: full strictly dominates read.
    expect(TIER_RANK.full > TIER_RANK.read).toBe(true);
  });
});

// ── pricedBondLogLines: the uncontainedScope WARN the spawner emits ───────────
// The pure helper turns breakdown.uncontainedScope into the operator-facing LOUD
// warn line. We test the exact text + the trigger here so the WARN is covered
// even though the spawn path always supplies a report (the spawner test proves
// the wiring; this proves the message).
describe('pricedBondLogLines — uncontainedScope LOUD warning', () => {
  test('uncontainedScope=true → a WARN naming the pricing≠containment gap', () => {
    // full tier priced against an armed guard (enforced=read) → uncontained.
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 0.01,
      capabilities: ['spawn:agent', 'backend:claude'],
      ttlMs: 300_000,
      coastGuardReport: armedReport(),
    });
    expect(breakdown.uncontainedScope).toBe(true);
    const { warnings } = pricedBondLogLines(breakdown, { bondUsd, agentId: 'a1', backend: 'claude-cli' });
    const uncontained = warnings.find((w) => w.includes('uncontained scope'));
    expect(uncontained).toBeDefined();
    expect(uncontained).toMatch(/WARN uncontained scope/);
    expect(uncontained).toMatch(/tier=full EXCEEDS/);
    expect(uncontained).toMatch(/pricing != containment/);
    expect(uncontained).toContain('agent=a1');
  });

  test('uncontainedScope=false (no report supplied) → NO uncontained warning', () => {
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 0.01,
      capabilities: ['spawn:agent', 'backend:claude'],
      ttlMs: 300_000,
      // no coastGuardReport → flag stays false (no posture to read)
    });
    expect(breakdown.uncontainedScope).toBe(false);
    const { warnings } = pricedBondLogLines(breakdown, { bondUsd });
    expect(warnings.some((w) => w.includes('uncontained scope'))).toBe(false);
  });

  test('a degraded posture (no sandbox) makes even a read-tier bond uncontained → WARN', () => {
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 1,
      capabilities: ['fs:read'], // read tier
      ttlMs: 60_000,
      coastGuardReport: armedReport({ mechanism: 'none', confinementAvailable: false }),
    });
    expect(breakdown.scopeTier).toBe('read');
    expect(breakdown.uncontainedScope).toBe(true); // degraded contains nothing
    const { warnings } = pricedBondLogLines(breakdown, { bondUsd });
    expect(warnings.some((w) => w.includes('uncontained scope'))).toBe(true);
  });
});
