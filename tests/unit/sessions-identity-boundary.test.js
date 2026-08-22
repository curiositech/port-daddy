/**
 * Negative tests for the identity write boundary (#8877 / ADR-0122 slice 1).
 *
 * Proves at the HTTP surface that on the sessions/notes/file-claims write
 * paths a forged daemon-minted credential is REJECTED (401), a valid
 * credential cannot launder another soul's name (403), and a bare
 * self-asserted agentId is only admitted as a VISIBLY flagged + logged
 * legacy downgrade — never silently accepted as verified identity.
 */
import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createActorSouls } from '../../lib/actor-souls.js';
import { resolveWriteIdentity } from '../../lib/identity-write-boundary.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

function buildApp({ withSouls = true } = {}) {
  const db = createTestDb();
  const sessions = createSessions(db);
  const souls = withSouls ? createActorSouls(db) : null;
  const logs = { info: [], error: [] };
  const logger = {
    info: (msg, meta) => logs.info.push({ msg, meta }),
    error: (msg, meta) => logs.error.push({ msg, meta }),
  };
  const app = Fastify();
  app.addHook('onClose', () => db.close());
  app.register(sessionsPlugin, {
    deps: {
      sessions,
      metrics: { errors: 0 },
      logger,
      activityLog: { log() {} },
      actorSouls: souls,
    },
  });
  return { app, db, sessions, souls, logs };
}

function mintSoul(souls, alias) {
  return souls.mint({ alias });
}

describe('identity write boundary — POST /sessions', () => {
  test('a forged credential is rejected 401 and NO session is created', async () => {
    const { app, sessions } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'forge attempt', agentId: 'victim:agent:one', credential: 'FORGEDID.not-the-secret' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(sessions.list({}).sessions).toHaveLength(0);
    await app.close();
  });

  test('a forged credential in the x-actor-credential header is also rejected 401', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { 'x-actor-credential': 'FORGEDID.bad' },
      payload: { purpose: 'header forge' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    await app.close();
  });

  test('a valid credential produces a VERIFIED session stamped with the minted actorId', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintSoul(souls, 'proj:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'legit work', credential: minted.credential },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.identity).toEqual(expect.objectContaining({ verified: true, actorId: minted.actorId }));
    const stored = sessions.get(body.id);
    expect(stored.session.metadata.identity.verified).toBe(true);
    expect(stored.session.metadata.identity.actorId).toBe(minted.actorId);
    await app.close();
  });

  test("a valid credential CANNOT write under another soul's alias (403)", async () => {
    const { app, souls } = buildApp();
    const attacker = mintSoul(souls, 'attacker:stack:ctx');
    mintSoul(souls, 'victim:stack:ctx'); // victim's alias now bound to a different soul
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'impersonation', agentId: 'victim:stack:ctx', credential: attacker.credential },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    await app.close();
  });

  test('a bare self-asserted agentId is admitted ONLY as a flagged, logged legacy downgrade', async () => {
    const { app, sessions, logs } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'legacy client', agentId: 'legacy:agent:one' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Visible on the response...
    expect(body.identity.verified).toBe(false);
    expect(body.identity.downgrade.mode).toBe('legacy-self-asserted');
    expect(body.identity.downgrade.assertedAgentId).toBe('legacy:agent:one');
    // ...persisted on the durable record...
    const stored = sessions.get(body.id);
    expect(stored.session.metadata.identity.verified).toBe(false);
    expect(stored.session.metadata.identity.downgrade.mode).toBe('legacy-self-asserted');
    // ...and loudly logged as a structured event.
    const downgradeLogs = logs.info.filter((l) => l.msg === 'legacy_identity_downgrade');
    expect(downgradeLogs).toHaveLength(1);
    expect(downgradeLogs[0].meta).toEqual(
      expect.objectContaining({ route: 'POST /sessions', assertedAgentId: 'legacy:agent:one' }),
    );
    await app.close();
  });

  test('the request body cannot pre-forge the identity metadata slot', async () => {
    const { app, sessions } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        purpose: 'metadata forge',
        agentId: 'sneaky:agent:one',
        metadata: { identity: { verified: true, actorId: 'FAKE' } },
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = sessions.get(res.json().id);
    // The daemon's verdict overwrites the caller-supplied forgery.
    expect(stored.session.metadata.identity.verified).toBe(false);
    expect(stored.session.metadata.identity.downgrade.mode).toBe('legacy-self-asserted');
    await app.close();
  });
});

describe('identity write boundary — notes writes', () => {
  test('a forged credential on POST /notes is rejected 401 and no note lands', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintSoul(souls, 'writer:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'note target', credential: minted.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'forged note', sessionId: started.id, agentId: minted.actorId, credential: `${minted.actorId}.wrong-secret` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(sessions.getNotes(started.id).notes).toHaveLength(0);
    await app.close();
  });

  test('a self-asserted note write is admitted but visibly downgraded, never silent', async () => {
    const { app, logs } = buildApp();
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'legacy notes', agentId: 'legacy:agent:two' },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: '/sessions/' + started.id + '/notes',
      payload: { content: 'legacy note', agentId: 'legacy:agent:two' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.identity.verified).toBe(false);
    expect(body.identity.downgrade.mode).toBe('legacy-self-asserted');
    const downgrades = logs.info.filter((l) => l.msg === 'legacy_identity_downgrade');
    expect(downgrades.map((l) => l.meta.route)).toContain('POST /sessions/:id/notes');
    await app.close();
  });

  test('a verified note write carries the verified identity verdict', async () => {
    const { app, souls } = buildApp();
    const minted = mintSoul(souls, 'writer:stack:two');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'verified notes', credential: minted.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'verified note', sessionId: started.id, credential: minted.credential },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().identity).toEqual(
      expect.objectContaining({ verified: true, actorId: minted.actorId }),
    );
    await app.close();
  });
});

describe('identity write boundary — file claim writes', () => {
  test('a forged credential on POST /sessions/:id/files is rejected 401 before any ownership check', async () => {
    const { app, souls } = buildApp();
    const minted = mintSoul(souls, 'claimer:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'claims', credential: minted.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/a.ts'], agentId: minted.actorId, credential: `${minted.actorId}.stolen` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    await app.close();
  });

  test('a forged credential on DELETE /sessions/:id/files cannot release another session\'s claims', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintSoul(souls, 'owner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'hold claims', credential: minted.credential, files: ['src/held.ts'] },
    })).json();

    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/held.ts'], agentId: minted.actorId, credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    const claims = sessions.listAllActiveClaims({});
    expect(claims.claims.some((c) => c.filePath === 'src/held.ts')).toBe(true);
    await app.close();
  });
});

describe('identity write boundary — fail-closed verifier', () => {
  test('a credential presented while the souls store is unavailable is rejected 503, never assumed valid', async () => {
    const { app } = buildApp({ withSouls: false });
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'no verifier', credential: 'ANYID.secret' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('IDENTITY_VERIFIER_UNAVAILABLE');
    await app.close();
  });

  test('resolveWriteIdentity never downgrades a present-but-invalid credential (unit)', () => {
    const db = createTestDb();
    const souls = createActorSouls(db);
    const logger = { info: jest.fn(), error: jest.fn() };
    const verdict = resolveWriteIdentity({
      souls,
      credential: 'NOPE.wrong',
      assertedAgentId: 'any:agent:id',
      route: 'unit',
      logger,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.code).toBe('IDENTITY_CREDENTIAL_INVALID');
    // No downgrade event fired — rejection is not a downgrade.
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'identity_write_rejected',
      expect.objectContaining({ code: 'IDENTITY_CREDENTIAL_INVALID' }),
    );
    db.close();
  });
});
