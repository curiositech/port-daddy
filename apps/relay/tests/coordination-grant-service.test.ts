import { describe, expect, it } from 'vitest';
import { verifyCoordinationMacaroon } from '../src/coordination-auth.js';
import {
  FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS,
  mintFleetCoordinationGrant,
} from '../src/coordination-grants.js';

const ROOT = '42'.repeat(32);
const PROJECT = 'curiositech/port-daddy';
const ACTOR = 'fleet:run:delivery-123';
const NOW = 1_800_000_000_000;

describe('internal Fleet coordination grant contract', () => {
  it('mints a short-lived capability scoped to one project and actor', () => {
    const grant = mintFleetCoordinationGrant(
      { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
      { project: PROJECT, actorId: ACTOR, ttlSeconds: 120 },
      NOW,
    );

    expect(grant).toMatchObject({
      project: PROJECT,
      actorId: ACTOR,
      verb: 'coordination-sync',
      expiresAt: NOW + 120_000,
    });
    expect(verifyCoordinationMacaroon(grant.macaroon, ROOT, {
      project: PROJECT,
      actorId: ACTOR,
      nowMs: NOW + 1,
    })).toMatchObject({ authorized: true });
  });

  it('cannot be replayed across projects or actors', () => {
    const grant = mintFleetCoordinationGrant(
      { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
      { project: PROJECT, actorId: ACTOR },
      NOW,
    );

    expect(verifyCoordinationMacaroon(grant.macaroon, ROOT, {
      project: 'curiositech/other',
      actorId: ACTOR,
      nowMs: NOW + 1,
    })).toMatchObject({ authorized: false, reason: 'project caveat mismatch' });
    expect(verifyCoordinationMacaroon(grant.macaroon, ROOT, {
      project: PROJECT,
      actorId: 'fleet:run:other',
      nowMs: NOW + 1,
    })).toMatchObject({ authorized: false, reason: 'actor caveat mismatch' });
  });

  it('fails closed on malformed tenant context, excessive ttl, or missing root', () => {
    expect(() => mintFleetCoordinationGrant(
      { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
      { project: '../escape', actorId: ACTOR },
      NOW,
    )).toThrow('invalid coordination project');
    expect(() => mintFleetCoordinationGrant(
      { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
      {
        project: PROJECT,
        actorId: ACTOR,
        ttlSeconds: FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS + 1,
      },
      NOW,
    )).toThrow('ttlSeconds');
    expect(() => mintFleetCoordinationGrant(
      {},
      { project: PROJECT, actorId: ACTOR },
      NOW,
    )).toThrow('not configured');
  });
});
