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

// ── pricedBondLogLines: the right-sized uncontainedScope level the spawner emits ─
// The pure helper turns breakdown.uncontainedScope into an operator-facing line,
// choosing the LEVEL by whether anything is actually contained:
//   • present-but-MODEST enforced tier (enforcedScopeTier !== null, today 'read'):
//     the priced tier merely outruns the sandbox — the KNOWN pricing-ahead-of-
//     containment gap that fires on ~100% of full-tier spawns. Steady state, not
//     an incident → an INFO `notices` line, NOT a WARN (an always-on WARN here
//     was the alarm-fatigue regression this gate now pins shut).
//   • null enforced tier (no OS sandbox at all): the spawn is structurally
//     unconfined → a LOUD `warnings` line.
// We test the exact text + the level routing here so the contract is covered even
// though the spawn path always supplies a report (the spawner test proves the
// wiring; this proves the message AND its level).
describe('pricedBondLogLines — uncontainedScope level (INFO steady-state vs WARN degraded)', () => {
  test('steady state (full priced, sandbox enforces read) → INFO notice, NOT a WARN', () => {
    // full tier priced against an armed guard (enforced=read) → uncontained, but
    // the benign, expected kind: a present-but-modest enforced tier. This is the
    // ~100%-of-spawns case, so it must be informative, not alarming.
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 0.01,
      capabilities: ['spawn:agent', 'backend:claude'],
      ttlMs: 300_000,
      coastGuardReport: armedReport(),
    });
    expect(breakdown.uncontainedScope).toBe(true);
    expect(breakdown.enforcedScopeTier).toBe('read'); // present-but-modest, NOT null
    const { notices, warnings } = pricedBondLogLines(breakdown, {
      bondUsd,
      agentId: 'a1',
      backend: 'claude-cli',
    });
    // The advisory rides the INFO `notices` channel…
    const advisory = notices.find((n) => n.includes('bond scope advisory'));
    expect(advisory).toBeDefined();
    expect(advisory).toMatch(/priced tier=full exceeds/);
    expect(advisory).toMatch(/enforced containment tier=read/);
    expect(advisory).toMatch(/pricing ahead of containment/);
    expect(advisory).toContain('agent=a1');
    // …and NOT the WARN channel. No uncontained WARN under an armed guard.
    expect(warnings.some((w) => w.includes('uncontained'))).toBe(false);
    expect(warnings).toEqual([]);
  });

  test('uncontainedScope=false (no report supplied) → NO advisory on either channel', () => {
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 0.01,
      capabilities: ['spawn:agent', 'backend:claude'],
      ttlMs: 300_000,
      // no coastGuardReport → flag stays false (no posture to read)
    });
    expect(breakdown.uncontainedScope).toBe(false);
    expect(breakdown.enforcedScopeTier).toBeUndefined(); // nothing was read
    const { notices, warnings } = pricedBondLogLines(breakdown, { bondUsd });
    expect(notices.some((n) => n.includes('scope advisory'))).toBe(false);
    expect(warnings.some((w) => w.includes('uncontained'))).toBe(false);
  });

  test('degraded posture (no OS sandbox) → a LOUD WARN: the spawn is truly unconfined', () => {
    // enforcedScopeTier === null means NOTHING is contained → ACTIONABLE anomaly.
    const { bondUsd, breakdown } = priceBond({
      baseUsd: 1,
      capabilities: ['fs:read'], // read tier — yet still uncontained when degraded
      ttlMs: 60_000,
      coastGuardReport: armedReport({ mechanism: 'none', confinementAvailable: false }),
    });
    expect(breakdown.scopeTier).toBe('read');
    expect(breakdown.uncontainedScope).toBe(true); // degraded contains nothing
    expect(breakdown.enforcedScopeTier).toBeNull(); // the WARN trigger
    const { notices, warnings } = pricedBondLogLines(breakdown, { bondUsd, agentId: 'a1' });
    const warn = warnings.find((w) => w.includes('uncontained scope'));
    expect(warn).toBeDefined();
    expect(warn).toMatch(/WARN uncontained scope/);
    expect(warn).toMatch(/NO OS sandbox is active/);
    expect(warn).toMatch(/structurally\s+unconfined/);
    expect(warn).toContain('agent=a1');
    // A degraded posture does NOT also emit the steady-state INFO notice.
    expect(notices.some((n) => n.includes('scope advisory'))).toBe(false);
  });

  test('degraded posture WARNs at EVERY priced tier (read/write/critical/full)', () => {
    const degraded = armedReport({ mechanism: 'none', confinementAvailable: false });
    for (const tier of ['read', 'write', 'critical', 'full']) {
      const { bondUsd, breakdown } = priceBond({
        baseUsd: 1,
        scopeTier: tier,
        ttlMs: 60_000,
        coastGuardReport: degraded,
      });
      expect(breakdown.enforcedScopeTier).toBeNull();
      const { warnings } = pricedBondLogLines(breakdown, { bondUsd });
      expect(warnings.some((w) => w.includes('WARN uncontained scope'))).toBe(true);
    }
  });
});
