/**
 * Negative + positive tests for the STRICT identity write boundary
 * (#8877 / ADR-0122).
 *
 * Proves at the HTTP surface that on the sessions/notes/file-claims write
 * paths:
 *   - a self-asserted agentId with NO credential is REJECTED 401
 *     (IDENTITY_CREDENTIAL_REQUIRED) — there is no downgrade middle state;
 *   - a forged daemon-minted credential is REJECTED 401
 *     (IDENTITY_CREDENTIAL_INVALID);
 *   - a valid credential cannot launder another soul's name (403
 *     IDENTITY_ALIAS_MISMATCH);
 *   - a minted credential produces a VERIFIED, stamped, attributed write;
 *   - truly anonymous writes (no identity claim at all) stay possible only
 *     where the route accepts unattributed writes.
 */
import Fastify from 'fastify';
import { jest } from '@jest/globals';
import { createTestDb } from '../setup-unit.js';
import { createSessions } from '../../lib/sessions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';
import { resolveWriteIdentity, stampIdentityMetadata } from '../../lib/identity-write-boundary.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

function buildApp({ withSouls = true, parleyAutoTrigger = null } = {}) {
  const db = createTestDb();
  const sessions = createSessions(db);
  const souls = withSouls ? createTestActorSouls(db) : null;
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
      parleyAutoTrigger,
    },
  });
  return { app, db, sessions, souls, logs };
}

describe('identity write boundary — POST /sessions', () => {
  test('a self-asserted agentId with no credential is rejected 401 and NO session is created', async () => {
    const { app, sessions, logs } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'self-asserted attempt', agentId: 'any:agent:one' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(sessions.list({}).sessions).toHaveLength(0);
    const rejects = logs.error.filter((l) => l.msg === 'identity_write_rejected');
    expect(rejects).toHaveLength(1);
    expect(rejects[0].meta).toEqual(
      expect.objectContaining({ route: 'POST /sessions', code: 'IDENTITY_CREDENTIAL_REQUIRED' }),
    );
    await app.close();
  });

  test('a self-asserted x-agent-id header with no credential is rejected 401 too', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: { 'x-agent-id': 'header:asserted:agent' },
      payload: { purpose: 'header assertion' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    await app.close();
  });

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
    const minted = mintTestActor(souls, 'proj:stack:ctx');
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

  test('a same-soul body alias is assertion-only and never becomes the session party', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintTestActor(souls, 'display-session-owner');
    expect(souls.register({
      credential: minted.credential,
      alias: 'secondary-session-display',
    })).toEqual(expect.objectContaining({ ok: true, actorId: minted.actorId }));

    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: minted.headers,
      payload: { purpose: 'canonical alias assertion', agentId: 'secondary-session-display' },
    });

    expect(response.statusCode).toBe(200);
    const stored = sessions.get(response.json().id).session;
    expect(stored.agentId).toBe(minted.actorId);
    expect(stored.agentId).not.toBe('secondary-session-display');
    expect(stored.metadata.identity.actorId).toBe(minted.actorId);
    await app.close();
  });

  test("a valid credential CANNOT write under another soul's alias (403)", async () => {
    const { app, souls } = buildApp();
    const attacker = mintTestActor(souls, 'attacker:stack:ctx');
    mintTestActor(souls, 'victim:stack:ctx'); // victim's alias now bound to a different soul
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'impersonation', agentId: 'victim:stack:ctx', credential: attacker.credential },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    await app.close();
  });

  test('an anonymous session (no identity claim at all) is still admitted, with no identity stamp', async () => {
    const { app, sessions } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'anonymous scratch session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.identity).toBeUndefined();
    const stored = sessions.get(body.id);
    expect(stored.session.metadata?.identity).toBeUndefined();
    await app.close();
  });

  test('an anonymous request cannot pre-forge the identity metadata slot', async () => {
    const { app, sessions } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        purpose: 'metadata forge',
        metadata: { identity: { verified: true, actorId: 'FAKE' }, keep: 'me' },
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = sessions.get(res.json().id);
    // The daemon strips the reserved verdict slot from anonymous writes.
    expect(stored.session.metadata.identity).toBeUndefined();
    expect(stored.session.metadata.keep).toBe('me');
    await app.close();
  });

  test('a credentialed request cannot pre-forge the identity metadata slot either', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintTestActor(souls, 'stamper:stack:ctx');
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: {
        purpose: 'metadata overwrite',
        credential: minted.credential,
        metadata: { identity: { verified: true, actorId: 'FAKE' } },
      },
    });
    expect(res.statusCode).toBe(200);
    const stored = sessions.get(res.json().id);
    expect(stored.session.metadata.identity.actorId).toBe(minted.actorId);
    await app.close();
  });
});

describe('identity write boundary — POST /sessions/:id/takeover', () => {
  test('takeover with a bare self-asserted agentId is rejected 401', async () => {
    const { app, souls } = buildApp();
    const owner = mintTestActor(souls, 'owner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'to be taken over', credential: owner.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/takeover`,
      payload: { agentId: 'successor:stack:ctx' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    await app.close();
  });

  test('takeover with NO identity claim at all is rejected 401 — the successor would inherit the predecessor\'s name', async () => {
    const { app, souls } = buildApp();
    const owner = mintTestActor(souls, 'anonowner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'attributed session', agentId: 'anonowner:stack:ctx', credential: owner.credential },
    })).json();

    // Bare-anonymous: no agentId, no x-agent-id header, no credential. The
    // successor record would still be ATTRIBUTED (it inherits the
    // predecessor's agent id), so the no-identity path must fail closed —
    // never an accidental anonymous write under someone else's name.
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/takeover`,
      payload: { note: 'anonymous grab' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    await app.close();
  });

  test('a different minted actor cannot take over another canonical session', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'owner2:stack:ctx');
    const successor = mintTestActor(souls, 'successor2:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'to be taken over', credential: owner.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/takeover`,
      payload: { agentId: 'successor2:stack:ctx', credential: successor.credential },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');
    expect(sessions.get(started.id).session.status).toBe('active');
    expect(sessions.list({ allWorktrees: true }).sessions).toHaveLength(1);
    await app.close();
  });

  test('the canonical owner can take over and a same-soul body alias never becomes the successor party', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'owner3:stack:ctx');
    expect(souls.register({
      credential: owner.credential,
      alias: 'owner3-secondary-display',
    })).toEqual(expect.objectContaining({ ok: true, actorId: owner.actorId }));
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'canonical owner takeover', credential: owner.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/takeover`,
      payload: {
        agentId: 'owner3-secondary-display',
        credential: owner.credential,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identity).toEqual(expect.objectContaining({ verified: true, actorId: owner.actorId }));
    const stored = sessions.get(body.successorId);
    expect(stored.session.agentId).toBe(owner.actorId);
    expect(stored.session.agentId).not.toBe('owner3-secondary-display');
    expect(stored.session.metadata.identity.actorId).toBe(owner.actorId);
    await app.close();
  });

  test('an unstamped legacy predecessor fails closed even with its actor credential', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'legacy-owner:stack:ctx');
    const legacy = sessions.start('unstamped legacy takeover', {
      agentId: owner.actorId,
      project: 'demo',
      durable: true,
      metadata: { displayIdentity: 'legacy-owner:stack:ctx' },
    });
    expect(legacy).toEqual(expect.objectContaining({ success: true }));

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${legacy.id}/takeover`,
      headers: owner.headers,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('SESSION_IDENTITY_UNVERIFIED');
    expect(sessions.get(legacy.id).session.status).toBe('active');
    expect(sessions.list({ allWorktrees: true }).sessions).toHaveLength(1);
    await app.close();
  });
});

describe('identity write boundary — generic session lifecycle routes', () => {
  test('PUT /sessions/:id is retired for missing, forged, and even valid credentials', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'retired-put-owner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'retired lifecycle target', credential: owner.credential },
    })).json();

    for (const request of [
      { payload: { status: 'completed' } },
      { headers: { 'x-actor-credential': 'FORGED.invalid' }, payload: { status: 'abandoned' } },
      { headers: owner.headers, payload: { status: 'completed' } },
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/sessions/${started.id}`,
        ...request,
      });
      expect(response.statusCode).toBe(404);
      expect(sessions.get(started.id).session.status).toBe('active');
    }
    await app.close();
  });

  test('PUT /sessions/:id/phase rejects anonymous and cross-actor mutation, then accepts the exact owner', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'phase-owner-display');
    const attacker = mintTestActor(souls, 'phase-attacker-display');
    expect(souls.register({
      credential: owner.credential,
      alias: 'phase-owner-secondary-display',
    })).toEqual(expect.objectContaining({ ok: true, actorId: owner.actorId }));
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: owner.headers,
      payload: { purpose: 'phase authority target' },
    })).json();
    const initialPhase = sessions.get(started.id).session.phase;

    const anonymous = await app.inject({
      method: 'PUT',
      url: `/sessions/${started.id}/phase`,
      payload: { phase: 'testing' },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const crossActor = await app.inject({
      method: 'PUT',
      url: `/sessions/${started.id}/phase`,
      headers: attacker.headers,
      payload: { phase: 'testing' },
    });
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');
    expect(sessions.get(started.id).session.phase).toBe(initialPhase);

    const exactOwner = await app.inject({
      method: 'PUT',
      url: `/sessions/${started.id}/phase`,
      headers: owner.headers,
      payload: { phase: 'testing', agentId: 'phase-owner-secondary-display' },
    });
    expect(exactOwner.statusCode).toBe(200);
    expect(exactOwner.json().phase).toBe('testing');
    expect(sessions.get(started.id).session.agentId).toBe(owner.actorId);
    await app.close();
  });

  test('PUT /sessions/:id/phase fails closed for an unstamped legacy owner row', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'legacy-phase-owner');
    const legacy = sessions.start('legacy phase target', {
      agentId: owner.actorId,
      durable: true,
      metadata: { displayIdentity: 'legacy-phase-owner' },
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/sessions/${legacy.id}/phase`,
      headers: owner.headers,
      payload: { phase: 'testing' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SESSION_IDENTITY_UNVERIFIED');
    expect(sessions.get(legacy.id).session.phase).toBe('in_progress');
    await app.close();
  });

  test('DELETE /sessions/:id rejects missing and forged credentials before archiving', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'delete-auth-owner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'delete credential target', credential: owner.credential },
    })).json();
    expect(sessions.end(started.id, { status: 'completed' }).success).toBe(true);

    const missing = await app.inject({ method: 'DELETE', url: `/sessions/${started.id}` });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const forged = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}`,
      headers: { 'x-actor-credential': 'FORGED.invalid' },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().code).toBe('IDENTITY_CREDENTIAL_INVALID');
    expect(sessions.get(started.id).session.metadata.archivedAt).toBeUndefined();
    await app.close();
  });

  test('a different valid actor cannot archive the owner session', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'delete-owner:stack:ctx');
    const attacker = mintTestActor(souls, 'delete-attacker:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'cross-owner archive target', credential: owner.credential },
    })).json();
    expect(sessions.end(started.id, { status: 'completed' }).success).toBe(true);

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}`,
      headers: attacker.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');
    expect(sessions.get(started.id).session.metadata.archivedAt).toBeUndefined();
    await app.close();
  });

  test('the owner cannot use generic DELETE to tear down an active session', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'active-delete-owner:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'active delete target', credential: owner.credential },
    })).json();

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}`,
      headers: owner.headers,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SESSION_ACTIVE_USE_SUGAR_DONE');
    expect(sessions.get(started.id).session.status).toBe('active');
    expect(sessions.get(started.id).session.metadata.archivedAt).toBeUndefined();
    await app.close();
  });

  test('the exact owner can archive a terminal session while caller aliases remain assertion-only', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'terminal-delete-owner:stack:ctx');
    expect(souls.register({
      credential: owner.credential,
      alias: 'terminal-delete-secondary-display',
    })).toEqual(expect.objectContaining({ ok: true, actorId: owner.actorId }));
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'terminal archive target', credential: owner.credential },
    })).json();
    expect(sessions.end(started.id, { status: 'completed' }).success).toBe(true);

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}`,
      headers: owner.headers,
      payload: { agentId: 'terminal-delete-secondary-display' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      id: started.id,
      status: 'completed',
      archived: true,
      notesPreserved: true,
    }));
    const archived = sessions.get(started.id).session;
    expect(archived.agentId).toBe(owner.actorId);
    expect(archived.agentId).not.toBe('terminal-delete-secondary-display');
    expect(archived.metadata.archivedAt).toEqual(expect.any(Number));
    await app.close();
  });

  test('an unstamped legacy terminal session cannot recover archive authority', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'legacy-delete-owner:stack:ctx');
    const legacy = sessions.start('legacy terminal archive', {
      agentId: owner.actorId,
      project: 'demo',
      durable: true,
      metadata: { displayIdentity: 'legacy-delete-owner:stack:ctx' },
    });
    expect(sessions.end(legacy.id, { status: 'completed' }).success).toBe(true);

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${legacy.id}`,
      headers: owner.headers,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SESSION_IDENTITY_UNVERIFIED');
    expect(sessions.get(legacy.id).session.metadata.archivedAt).toBeUndefined();
    await app.close();
  });
});

describe('identity write boundary — notes writes', () => {
  test('a self-asserted agentId on POST /notes is rejected 401 and no note lands', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintTestActor(souls, 'writer:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'note target', credential: minted.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'self-asserted note', sessionId: started.id, agentId: 'writer:stack:ctx' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    expect(sessions.getNotes(started.id).notes).toHaveLength(0);
    await app.close();
  });

  test('a forged credential on POST /notes is rejected 401 and no note lands', async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintTestActor(souls, 'writer2:stack:ctx');
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

  test("a valid credential cannot write a note under another soul's alias (403) — both alias routes", async () => {
    const { app, souls } = buildApp();
    const attacker = mintTestActor(souls, 'noteattacker:stack:ctx');
    mintTestActor(souls, 'notevictim:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'target', credential: attacker.credential },
    })).json();

    const canonical = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'laundered', sessionId: started.id, agentId: 'notevictim:stack:ctx', credential: attacker.credential },
    });
    expect(canonical.statusCode).toBe(403);
    expect(canonical.json().code).toBe('IDENTITY_ALIAS_MISMATCH');

    const alias = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/notes`,
      payload: { content: 'laundered', agentId: 'notevictim:stack:ctx', credential: attacker.credential },
    });
    expect(alias.statusCode).toBe(403);
    expect(alias.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    await app.close();
  });

  test('a verified note write carries the verified identity verdict', async () => {
    const { app, souls } = buildApp();
    const minted = mintTestActor(souls, 'writer:stack:two');
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

  test('anonymous and cross-actor callers cannot append to a selected canonical session', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'selected-note-owner');
    const attacker = mintTestActor(souls, 'selected-note-attacker');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: owner.headers,
      payload: { purpose: 'selected note target' },
    })).json();

    const anonymous = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'anonymous selected note', sessionId: started.id },
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const crossActor = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/notes`,
      headers: attacker.headers,
      payload: { content: 'cross-actor selected note' },
    });
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');
    expect(sessions.getNotes(started.id).notes).toHaveLength(0);
    await app.close();
  });

  test('an anonymous note without a caller-selected session retains unattributed semantics', async () => {
    const { app, sessions } = buildApp();
    const anonymousSession = sessions.start('anonymous host session');
    const response = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'anonymous quick note' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      success: true,
      sessionId: anonymousSession.id,
    }));
    expect(response.json().identity).toBeUndefined();
    await app.close();
  });
});

describe('identity write boundary — file claim writes', () => {
  test('a self-asserted agentId on POST /sessions/:id/files is rejected 401', async () => {
    const { app, souls } = buildApp();
    const minted = mintTestActor(souls, 'claimer:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'claims', agentId: 'claimer:stack:ctx', credential: minted.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/a.ts'], agentId: 'claimer:stack:ctx' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    await app.close();
  });

  test('a forged credential on POST /sessions/:id/files is rejected 401 before any ownership check', async () => {
    const { app, souls } = buildApp();
    const minted = mintTestActor(souls, 'claimer2:stack:ctx');
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

  test("a forged credential on DELETE /sessions/:id/files cannot release another session's claims", async () => {
    const { app, souls, sessions } = buildApp();
    const minted = mintTestActor(souls, 'owner:stack:files');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'hold claims', credential: minted.credential, agentId: 'owner:stack:files', files: ['src/held.ts'] },
    })).json();

    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/held.ts'], agentId: 'owner:stack:files', credential: 'FORGED.creds' },
    });
    expect(res.statusCode).toBe(401);
    const claims = sessions.listAllActiveClaims({});
    expect(claims.claims.some((c) => c.filePath === 'src/held.ts')).toBe(true);
    await app.close();
  });

  test("a DIFFERENT soul's valid credential cannot mutate claims on a stamped session even if it knows the owner string", async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'realowner:stack:ctx');
    // The attacker holds a REAL credential, and asserts the owner's UNBOUND
    // display string (an id that never became a soul alias).
    const attacker = mintTestActor(souls);
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'hold claims', credential: owner.credential, agentId: 'unbound-display-name', files: ['src/held2.ts'] },
    })).json();

    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/held2.ts'], agentId: 'unbound-display-name', credential: attacker.credential },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');
    const claims = sessions.listAllActiveClaims({});
    expect(claims.claims.some((c) => c.filePath === 'src/held2.ts')).toBe(true);
    await app.close();
  });

  test('an unstamped legacy session cannot recover file-claim authority from a valid credential', async () => {
    const { app, souls, sessions } = buildApp();
    const owner = mintTestActor(souls, 'legacy-claim-owner');
    const legacy = sessions.start('legacy claim authority', {
      agentId: owner.actorId,
      durable: true,
      metadata: { displayIdentity: 'legacy-claim-owner' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/sessions/${legacy.id}/files`,
      headers: owner.headers,
      payload: { files: ['src/legacy-authority.ts'] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SESSION_IDENTITY_UNVERIFIED');
    expect(sessions.listAllActiveClaims({}).claims).toHaveLength(0);
    await app.close();
  });

  test('the owning soul claims and releases files successfully (positive path)', async () => {
    const { app, souls } = buildApp();
    const minted = mintTestActor(souls, 'legit:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'claim flow', credential: minted.credential, agentId: 'legit:stack:ctx' },
    })).json();

    const claim = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/mine.ts'], agentId: 'legit:stack:ctx', credential: minted.credential },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().claimed).toEqual(['src/mine.ts']);

    const release = await app.inject({
      method: 'DELETE',
      url: `/sessions/${started.id}/files`,
      payload: { files: ['src/mine.ts'], agentId: 'legit:stack:ctx', credential: minted.credential },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().released).toEqual(['src/mine.ts']);
    await app.close();
  });

  test('alias-owned and unstamped active rows cannot become automatic conflict-signal parties or liveness proof', async () => {
    const evaluate = jest.fn(() => ({ state: 'started', parleyId: 'should-not-run' }));
    const { app, souls, sessions } = buildApp({ parleyAutoTrigger: { evaluate } });
    const legacyHolder = mintTestActor(souls, 'legacy-signal-holder');
    const challenger = mintTestActor(souls, 'canonical-signal-challenger');
    const aliasOwned = sessions.start('alias-owned signal holder', {
      agentId: 'legacy-signal-holder',
      files: ['src/alias-owned-signal.ts'],
      metadata: {
        identity: { verified: true, actorId: legacyHolder.actorId },
      },
    });
    expect(aliasOwned.success).toBe(true);
    const challengerSession = (await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: challenger.headers,
      payload: { purpose: 'canonical challenger' },
    })).json();

    const holderConflict = await app.inject({
      method: 'POST',
      url: `/sessions/${challengerSession.id}/files`,
      headers: challenger.headers,
      payload: { files: ['src/alias-owned-signal.ts'] },
    });
    expect(holderConflict.statusCode).toBe(409);
    expect(holderConflict.json().code).toBe('FILE_CONFLICT');

    const canonicalHolder = mintTestActor(souls, 'canonical-signal-holder');
    const holderSession = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: canonicalHolder.headers,
      payload: { purpose: 'canonical holder', files: ['src/legacy-liveness.ts'] },
    });
    expect(holderSession.statusCode).toBe(200);
    const legacyRequester = mintTestActor(souls, 'legacy-signal-requester');
    const legacyRequesterSession = sessions.start('unstamped requester liveness', {
      agentId: 'legacy-signal-requester',
      metadata: { displayIdentity: 'legacy-signal-requester' },
    });
    expect(legacyRequesterSession.success).toBe(true);

    const livenessConflict = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: legacyRequester.headers,
      payload: {
        purpose: 'must not inherit legacy liveness',
        files: ['src/legacy-liveness.ts'],
      },
    });
    expect(livenessConflict.statusCode).toBe(409);
    expect(livenessConflict.json().code).toBe('FILE_CONFLICT');
    expect(evaluate).not.toHaveBeenCalled();
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

  test('a self-asserted agentId while the souls store is unavailable is STILL rejected 401', async () => {
    const { app } = buildApp({ withSouls: false });
    const res = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'no verifier, no credential', agentId: 'self:asserted:id' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');
    await app.close();
  });

  test('resolveWriteIdentity has no downgrade state: invalid credential rejects, bare assertion rejects (unit)', () => {
    const db = createTestDb();
    const souls = createTestActorSouls(db);
    const logger = { info: jest.fn(), error: jest.fn() };

    const forged = resolveWriteIdentity({
      souls,
      credential: 'NOPE.wrong',
      assertedAgentId: 'any:agent:id',
      route: 'unit',
      logger,
    });
    expect(forged.ok).toBe(false);
    expect(forged.code).toBe('IDENTITY_CREDENTIAL_INVALID');

    const bare = resolveWriteIdentity({
      souls,
      assertedAgentId: 'any:agent:id',
      route: 'unit',
      logger,
    });
    expect(bare.ok).toBe(false);
    expect(bare.code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const anonymous = resolveWriteIdentity({ souls, route: 'unit', logger });
    expect(anonymous).toEqual({ ok: true, kind: 'anonymous', agentId: null, identity: null });

    const required = resolveWriteIdentity({ souls, route: 'unit', logger, requireIdentity: true });
    expect(required.ok).toBe(false);
    expect(required.code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    // No 'info' downgrade events exist any more; every rejection is an error.
    expect(logger.info).not.toHaveBeenCalled();
    db.close();
  });

  test('stampIdentityMetadata strips the reserved slot from anonymous writes (unit)', () => {
    const anonymous = { ok: true, kind: 'anonymous', agentId: null, identity: null };
    expect(stampIdentityMetadata({ identity: { verified: true, actorId: 'FAKE' }, keep: 1 }, anonymous))
      .toEqual({ keep: 1 });
    expect(stampIdentityMetadata(null, anonymous)).toBeNull();
  });
});
