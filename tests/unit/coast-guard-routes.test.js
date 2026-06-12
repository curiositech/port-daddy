/**
 * Coast Guard rent → slash routes (ADR-0050, phase 7) — route-level wiring.
 *
 * Proves the daemon surface end-to-end with Fastify inject() over a REAL
 * in-memory bonds ledger + breach ledger (no mocked money math), and the
 * load-bearing security property: the breaching PRINCIPAL is derived from the
 * caller's own SESSION, never from the request body — so a caller cannot name a
 * neighbour to slash them.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createBonds } from '../../lib/bonds.js';
import { createRentBreachLedger } from '../../lib/coast-guard/rent-breach-ledger.js';
import { coastGuardPlugin } from '../../routes/coast-guard.js';

const PROJECT = 'port-daddy';
const PRINCIPAL = 'port-daddy:api:main';

/** A minimal sessions stub: a fixed table of sessionId → session view. */
function makeSessions(table) {
  return {
    get(sessionId) {
      const s = table[sessionId];
      if (!s) return { success: false, error: 'session not found' };
      return { success: true, session: s };
    },
  };
}

describe('coastGuardPlugin — rent → slash routes', () => {
  let db;
  let bonds;
  let breachLedger;
  let app;
  let mode; // mutable; resolveMode returns this

  async function build(sessionTable) {
    db = createTestDb();
    bonds = createBonds(db);
    breachLedger = createRentBreachLedger(db);
    app = Fastify();
    await app.register(coastGuardPlugin, {
      deps: {
        bonds,
        breachLedger,
        sessions: makeSessions(sessionTable),
        logger: { info: () => {}, warn: () => {}, error: () => {} },
        resolveMode: () => mode,
        metrics: { errors: 0 },
      },
    });
    await app.ready();
  }

  const defaultSessions = () => ({
    'sess-breacher': { agentId: PRINCIPAL, identityProject: PROJECT, status: 'active' },
    'sess-neighbour': {
      agentId: 'port-daddy:api:neighbour',
      identityProject: PROJECT,
      status: 'active',
    },
  });

  beforeEach(() => {
    mode = 'advisory';
  });

  afterEach(async () => {
    if (app) await app.close();
    if (db) db.close();
  });

  function escrow(agentId, bondUsd) {
    const r = bonds.escrow({ project: PROJECT, agentId, bondUsd });
    bonds.markRunning(r.id);
    return r.id;
  }

  it('ADVISORY (default mode) — records the breach, returns the would-slash, debits NOTHING', async () => {
    await build(defaultSessions());
    bonds.topUpWallet(PROJECT, 10);
    const bondId = escrow(PRINCIPAL, 1.0);
    const before = bonds.conservation(PROJECT);

    // First breach → grace (no would-slash even in advisory).
    let res = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: { sessionId: 'sess-breacher' },
    });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    expect(body.mode).toBe('advisory');
    expect(body.breachCount).toBe(1);
    expect(body.shouldSlash).toBe(false);
    expect(body.slashed).toBe(false);

    // Second breach → would-slash 10%, but advisory debits nothing.
    res = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: { sessionId: 'sess-breacher' },
    });
    body = res.json();
    expect(body.breachCount).toBe(2);
    expect(body.shouldSlash).toBe(true);
    expect(body.amountUsd).toBeCloseTo(0.1, 6);
    expect(body.slashed).toBe(false);
    expect(body.bondId).toBe(bondId);

    // The ledger moved no money.
    const after = bonds.conservation(PROJECT);
    expect(after).toEqual(before);
    expect(bonds.getBond(bondId).state).toBe('running');
  });

  it('ENFORCE — debits the breaching principal\'s bond with the graduated amount, conservation holds', async () => {
    mode = 'enforce';
    await build(defaultSessions());
    bonds.topUpWallet(PROJECT, 10);
    const bondId = escrow(PRINCIPAL, 1.0);

    // Drive to breach #2 (first is grace).
    await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: { sessionId: 'sess-breacher' } });
    const before = bonds.conservation(PROJECT);
    const res = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: { sessionId: 'sess-breacher' },
    });
    const body = res.json();

    expect(body.mode).toBe('enforce');
    expect(body.slashed).toBe(true);
    expect(body.amountUsd).toBeCloseTo(0.1, 6); // 10% of $1
    expect(bonds.getBond(bondId).state).toBe('slashed');

    const after = bonds.conservation(PROJECT);
    expect(after.commonsUsd).toBeCloseTo(before.commonsUsd + 0.1, 6);
    expect(after.supplyUsd).toBeCloseTo(before.supplyUsd, 6);
  });

  it('SYBIL — the principal comes from the SESSION, not the body; a foreign principal field is ignored', async () => {
    mode = 'enforce';
    await build(defaultSessions());
    bonds.topUpWallet(PROJECT, 10);
    const neighbourBond = escrow('port-daddy:api:neighbour', 1.0);
    const ownBond = escrow(PRINCIPAL, 1.0);

    // The breacher tries to inject the neighbour's identity in the body to get
    // THEM slashed. The route must ignore body.principal entirely.
    await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: { sessionId: 'sess-breacher' } });
    const res = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: {
        sessionId: 'sess-breacher',
        principal: 'port-daddy:api:neighbour', // ATTACK: spoof the victim
        project: PROJECT,
      },
    });
    const body = res.json();

    // The slash landed on the BREACHER's own bond, not the neighbour's.
    expect(body.principal).toBe(PRINCIPAL);
    expect(body.bondId).toBe(ownBond);
    expect(bonds.getBond(ownBond).state).toBe('slashed');
    expect(bonds.getBond(neighbourBond).state).toBe('running'); // untouched
  });

  it('rent-cure de-escalates the caller\'s own breach count', async () => {
    await build(defaultSessions());
    // Two breaches → count 2.
    await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: { sessionId: 'sess-breacher' } });
    await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: { sessionId: 'sess-breacher' } });

    const res = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-cure',
      payload: { sessionId: 'sess-breacher' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().breachCount).toBe(1); // decayed by one
  });

  it('rent-status reports the mode and the caller\'s breach state (side-effect free)', async () => {
    await build(defaultSessions());
    await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: { sessionId: 'sess-breacher' } });

    const res = await app.inject({
      method: 'GET',
      url: '/coast-guard/rent-status?sessionId=sess-breacher',
    });
    const body = res.json();
    expect(body.mode).toBe('advisory');
    expect(body.principal).toBe(PRINCIPAL);
    expect(body.state.breachCount).toBe(1);

    // No session → just the mode.
    const res2 = await app.inject({ method: 'GET', url: '/coast-guard/rent-status' });
    expect(res2.json()).toEqual({ success: true, mode: 'advisory', state: null });
  });

  it('rejects a missing session (404) and a session with no identity (422)', async () => {
    await build({
      'sess-no-identity': { agentId: null, identityProject: PROJECT, status: 'active' },
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: { sessionId: 'does-not-exist' },
    });
    expect(missing.statusCode).toBe(404);

    const noId = await app.inject({
      method: 'POST',
      url: '/coast-guard/rent-breach',
      payload: { sessionId: 'sess-no-identity' },
    });
    expect(noId.statusCode).toBe(422);

    const noBody = await app.inject({ method: 'POST', url: '/coast-guard/rent-breach', payload: {} });
    expect(noBody.statusCode).toBe(400);
  });
});
