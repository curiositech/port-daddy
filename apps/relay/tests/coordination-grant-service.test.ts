import { describe, expect, it, vi } from 'vitest';
import { verifyCoordinationMacaroon } from '../src/coordination-auth.js';
import { CoordinationGrantService } from '../src/coordination-grant-service.js';
import {
  FLEET_COORDINATION_GRANT_DEFAULT_TTL_SECONDS,
  FLEET_COORDINATION_GRANT_MAX_TTL_SECONDS,
  mintFleetCoordinationGrant,
} from '../src/coordination-grants.js';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));

const ROOT = '42'.repeat(32);
const PROJECT = 'curiositech/port-daddy';
const ACTOR = 'fleet:run:delivery-123';
const NOW = 1_800_000_000_000;

describe('internal Fleet coordination grant contract', () => {
  it('keeps the named entrypoint closed to public HTTP callers', async () => {
    const service = Object.create(CoordinationGrantService.prototype) as CoordinationGrantService;
    const response = service.fetch();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not found', code: 'NOT_FOUND' });
  });

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

  it.each([
    ['', ACTOR, 'project'],
    ['/leading-separator', ACTOR, 'project'],
    ['contains space', ACTOR, 'project'],
    ['a'.repeat(201), ACTOR, 'project'],
    [PROJECT, '', 'actor'],
    [PROJECT, ':leading-separator', 'actor'],
    [PROJECT, 'fleet actor', 'actor'],
  ])('rejects malformed project/actor scope (%s, %s)', (project, actorId, expected) => {
    expect(() => mintFleetCoordinationGrant(
      { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
      { project, actorId },
      NOW,
    )).toThrow(`invalid coordination ${expected}`);
  });

  it('accepts the project boundary and uses the bounded default clock path', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const project = 'a'.repeat(200);
      const grant = mintFleetCoordinationGrant(
        { COORDINATION_MACAROON_ROOT_KEY_HEX: ROOT },
        { project, actorId: ACTOR },
      );

      expect(grant).toMatchObject({
        project,
        actorId: ACTOR,
        expiresAt: NOW + FLEET_COORDINATION_GRANT_DEFAULT_TTL_SECONDS * 1000,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
