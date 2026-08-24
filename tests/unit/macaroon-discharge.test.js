/**
 * End-to-end tests for the rent-paid discharge + push gate (ADR-0053 Phase 1).
 *
 * This is the whole enforcement story in one file: the daemon mints a push grant
 * carrying a "rent-paid for session S" third-party caveat; the agent can only
 * obtain a discharge when `evaluateLeaseRent` says rent is current; and the gate
 * authorizes a push only when the grant + a valid, bound, unexpired discharge
 * satisfy every first-party caveat for the concrete request.
 */
import { describe, expect, test } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import {
  mintActorBoundPushGrant,
  dischargeRentPaid,
  prepareForRequest,
  verifyPushGrant,
} from '../../lib/macaroon/index.js';

const T = 1_700_000_000_000; // fixed base time (unix ms)
const ACTOR = '01K3YR6M1WPZB8Q6V1J8K7D4MC';

const paidFacts = () => ({
  commitsSinceLastNote: 0,
  commitsTotal: 3,
  notesTotal: 3,
  claimsTotal: 1,
  commitsBehindBase: 0,
  ageMs: 60_000,
  lastSignalAgeMs: 1_000,
});

function setup(actor = ACTOR) {
  const rootKey = randomBytes(32);
  const caveatKey = randomBytes(32);
  const session = 'session-abc';
  const repoId = 'curiositech/port-daddy';
  const { macaroon, rentCaveatId, record } = mintActorBoundPushGrant({
    rootKey,
    grantId: 'grant-1',
    repoId,
    actor,
    session,
    expiresMs: T + 60 * 60 * 1000, // 1h grant
    caveatKey,
    rentNonce: 'nonce-1',
  });
  return { rootKey, caveatKey, session, repoId, macaroon, rentCaveatId, record };
}

/** Run the full discharge → bind → verify flow with a given facts/ctx. */
function attemptPush(s, { facts, ctx, dischargeNowMs = T }) {
  const d = dischargeRentPaid({
    record: s.record,
    rentCaveatId: s.rentCaveatId,
    session: s.session,
    facts,
    nowMs: dischargeNowMs,
  });
  if (!d.ok) return { discharge: d, gate: null };
  const bound = prepareForRequest(s.macaroon, d.discharge);
  const gate = verifyPushGrant(s.macaroon, s.rootKey, [bound], ACTOR, ctx, (id) =>
    id === s.rentCaveatId ? s.caveatKey : null,
  );
  return { discharge: d, gate };
}

const pushCtx = (over = {}) => ({
  op: 'push',
  repo: 'curiositech/port-daddy',
  branch: 'feat/dom-daddy-x',
  session: 'session-abc',
  nowMs: T + 5 * 60 * 1000, // 5 min after mint — inside both grant + discharge TTL
  ...over,
});

describe('happy path — rent paid authorizes the push', () => {
  test('a coordinating session gets a discharge and the gate authorizes', () => {
    const s = setup();
    const { discharge, gate } = attemptPush(s, { facts: paidFacts(), ctx: pushCtx() });
    expect(discharge.ok).toBe(true);
    expect(discharge.evaluation.verdict).toBe('paid');
    expect(gate.authorized).toBe(true);
  });

  test('session ids and aliases cannot be minted or substituted as actors', () => {
    for (const nonPrincipal of ['session-abc', 'spark', 'operator:local']) {
      expect(() => setup(nonPrincipal)).toThrow(/actor-bound/);
    }
    const s = setup();
    const gate = verifyPushGrant(
      s.macaroon,
      s.rootKey,
      [],
      '01K3YR6M1WPZB8Q6V1J8K7D4MD',
      pushCtx(),
      () => null,
    );
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/actor-bound push authority/);
  });
});

describe('rent not paid — discharge is refused with a corrective reason', () => {
  test('rent-due (committed without a note) refuses the discharge', () => {
    const s = setup();
    const facts = { ...paidFacts(), commitsSinceLastNote: 2 };
    const { discharge } = attemptPush(s, { facts, ctx: pushCtx() });
    expect(discharge.ok).toBe(false);
    expect(discharge.evaluation.verdict).toBe('rent-due');
    expect(discharge.reason).toMatch(/coordination note/);
    // The corrective copy must NOT advertise any bypass.
    expect(discharge.reason).not.toMatch(/PD_SHIM_OFF|bypass|--no-verify/);
  });

  test('idle (dark lease) refuses the discharge', () => {
    const s = setup();
    const facts = {
      commitsSinceLastNote: 0,
      commitsTotal: 0,
      notesTotal: 0,
      claimsTotal: 0,
      commitsBehindBase: 0,
      ageMs: 31 * 60 * 1000,
      lastSignalAgeMs: 31 * 60 * 1000,
    };
    const { discharge } = attemptPush(s, { facts, ctx: pushCtx() });
    expect(discharge.ok).toBe(false);
    expect(discharge.evaluation.verdict).toBe('idle');
  });

  test('without a discharge the gate rejects (no rent, no push)', () => {
    const s = setup();
    const gate = verifyPushGrant(s.macaroon, s.rootKey, [], ACTOR, pushCtx(), (id) =>
      id === s.rentCaveatId ? s.caveatKey : null,
    );
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/no discharge macaroon/);
  });
});

describe('first-party caveats hold even with a valid discharge', () => {
  test('push to the protected branch (main) is rejected', () => {
    const s = setup();
    const { gate } = attemptPush(s, { facts: paidFacts(), ctx: pushCtx({ branch: 'main' }) });
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/branch != main/);
  });

  test('a non-push operation is rejected', () => {
    const s = setup();
    const { gate } = attemptPush(s, { facts: paidFacts(), ctx: pushCtx({ op: 'api-call' }) });
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/op = push/);
  });

  test('a push to a different repo is rejected', () => {
    const s = setup();
    const { gate } = attemptPush(s, { facts: paidFacts(), ctx: pushCtx({ repo: 'evil/other' }) });
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/actor-bound push authority/);
  });

  test('a push under a different session is rejected', () => {
    const s = setup();
    const { gate } = attemptPush(s, {
      facts: paidFacts(),
      ctx: pushCtx({ session: 'session-other' }),
    });
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/actor-bound push authority/);
  });

  test('a push after the grant has expired is rejected', () => {
    const s = setup();
    const { gate } = attemptPush(s, {
      facts: paidFacts(),
      ctx: pushCtx({ nowMs: T + 2 * 60 * 60 * 1000 }), // 2h > 1h grant
    });
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/expires = /);
  });
});

describe('discharge TTL — a stale discharge stops working within one window', () => {
  test('a discharge older than its 20-min TTL fails the gate', () => {
    const s = setup();
    // Discharge minted at T; request 25 min later (> 20-min TTL), but still
    // inside the 1h grant so only the discharge expiry should bite.
    const { discharge, gate } = attemptPush(s, {
      facts: paidFacts(),
      dischargeNowMs: T,
      ctx: pushCtx({ nowMs: T + 25 * 60 * 1000 }),
    });
    expect(discharge.ok).toBe(true);
    expect(gate.authorized).toBe(false);
    expect(gate.reason).toMatch(/expires = /);
  });
});

describe('session binding on the discharge request', () => {
  test('requesting a discharge for the wrong session is refused', () => {
    const s = setup();
    const d = dischargeRentPaid({
      record: s.record,
      rentCaveatId: s.rentCaveatId,
      session: 'session-mismatch',
      facts: paidFacts(),
      nowMs: T,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/different session/);
  });
});
