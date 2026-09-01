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

function readyContextLookup(sourceSessionId) {
  const packet = {
    schema: 'pd.agent-harbor.compaction-packet.v0',
    packetId: 'cpk_route_fixture',
    agentNodeId: 'agent_route_fixture',
    sessionId: sourceSessionId,
    createdAt: '2026-08-27T00:00:00.000Z',
    createdBy: { kind: 'daemon' },
    trigger: { kind: 'context-threshold', contextEnvelopeRef: 'ctx_route_fixture' },
    identity: { task: 'Follow the verified route plan' },
    obligations: [],
    factualClaims: [],
    transcriptExcerpts: [{ citation: { kind: 'transcript-event', transcriptEventId: 'evt_raw' }, excerpt: 'ROUTE_RAW_TRANSCRIPT_MUST_NOT_ESCAPE' }],
    nextAction: { recommendation: 'Continue from the cited plan.' },
    sourceTranscript: { headEventId: 'evt_route_head', headHash: 'route_hash' },
    validator: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    transcriptEventId: 'evt_route_packet',
  };
  return {
    status: 'ready',
    sourceSessionId,
    packet,
    bootstrap: {
      packet,
      sessionId: sourceSessionId,
      agentNodeId: 'agent_route_fixture',
      planCheckpoint: {
        transcriptEventId: 'evt_route_plan',
        content: '- [ ] Carry forward the cited route plan',
        capturedAt: '2026-08-27T00:00:00.000Z',
      },
      transcriptPrefix: [{ transcriptEventId: 'evt_raw', sequence: 9, kind: 'tool_result', ledgerSeq: 12 }],
      transcriptPrefixTruncated: false,
      contextRef: { kind: 'compaction-packet', ref: 'packet:cpk_route_fixture', droppable: false },
      revalidation: { passed: true, uncitedClaimCount: 0, missingObligationWarnings: [] },
    },
    envelope: { schema: 'pd.agent-harbor.context-envelope.v0' },
  };
}

function buildApp({ withSouls = true, contextBootstrapLookup } = {}) {
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
      contextBootstrapLookup,
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
    expect(body.contextContinuation).toEqual({ status: 'none' });
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

  test('takeover with a minted credential succeeds and stamps the successor actorId', async () => {
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
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.identity).toEqual(expect.objectContaining({ verified: true, actorId: successor.actorId }));
    const stored = sessions.get(body.successorId);
    expect(stored.session.metadata.identity.actorId).toBe(successor.actorId);
    await app.close();
  });

  test('takeover reads only a bounded, verified predecessor continuation', async () => {
    const seen = [];
    const { app, souls } = buildApp({
      contextBootstrapLookup: (sourceSessionId) => {
        seen.push(sourceSessionId);
        return readyContextLookup(sourceSessionId);
      },
    });
    const owner = mintTestActor(souls, 'contextowner:stack:ctx');
    const successor = mintTestActor(souls, 'contextsuccessor:stack:ctx');
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'predecessor with verified context', credential: owner.credential },
    })).json();

    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${started.id}/takeover`,
      payload: { agentId: 'contextsuccessor:stack:ctx', credential: successor.credential },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(seen).toEqual([started.id]);
    expect(body.contextContinuation).toEqual(expect.objectContaining({
      status: 'ready',
      sourceSessionId: started.id,
      packet: expect.objectContaining({ packetId: 'cpk_route_fixture' }),
      planCheckpoint: expect.objectContaining({ content: '- [ ] Carry forward the cited route plan' }),
    }));
    expect(body.contextContinuation).not.toHaveProperty('transcriptPrefix');
    expect(JSON.stringify(body.contextContinuation)).not.toContain('ROUTE_RAW_TRANSCRIPT_MUST_NOT_ESCAPE');
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

  test('a fully anonymous note (no agentId, no credential) is still admitted', async () => {
    const { app } = buildApp();
    const started = (await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { purpose: 'anonymous host session' },
    })).json();
    const res = await app.inject({
      method: 'POST',
      url: '/notes',
      payload: { content: 'anonymous quick note', sessionId: started.id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
    expect(res.json().identity).toBeUndefined();
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
    expect(res.json().code).toBe('SESSION_AGENT_MISMATCH');
    const claims = sessions.listAllActiveClaims({});
    expect(claims.claims.some((c) => c.filePath === 'src/held2.ts')).toBe(true);
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
