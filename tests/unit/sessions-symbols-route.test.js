import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSymbolClaims } from '../../lib/symbol-claims.js';
import { createSuggestions } from '../../lib/suggestions.js';
import { createTestActorSouls, mintTestActor } from '../helpers/actor-credentials.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
];

function buildApp({ predictConflicts = () => [] } = {}) {
  const app = Fastify();
  const db = createTestDb();
  const souls = createTestActorSouls(db);
  const sent = [];
  const symbolIndex = {
    getDependents: (f, s) => EDGES.filter((e) => e.targetFile === f && e.targetSymbol === s).map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType })),
    predictConflicts,
  };
  const actors = Object.fromEntries(['s1', 's2', 's3'].map((id) => {
    const alias = `symbol-${id}-display`;
    return [id, { ...mintTestActor(souls, alias), alias }];
  }));
  const sessionsById = new Map(Object.entries(actors).map(([id, actor]) => [id, {
    id,
    status: 'active',
    agentId: actor.actorId,
    purpose: `purpose-${id}`,
    metadata: {
      identity: { verified: true, actorId: actor.actorId },
    },
  }]));
  const sessionFor = (id) => sessionsById.get(id) ?? null;
  const symbolClaims = createSymbolClaims(db, {
    symbolIndex,
    now: () => 1000,
    agentForSession: (id) => sessionFor(id)?.agentId ?? null,
  });
  const suggestions = createSuggestions(db, { now: () => 1000 });
  const agentInbox = {
    send(agentId, content, options) {
      sent.push({ agentId, content, options });
      return { success: true, messageId: sent.length };
    },
  };
  app.addHook('onClose', () => db.close());
  app.register(sessionsPlugin, {
    deps: {
      sessions: {
        get: (id) => {
          const session = sessionFor(id);
          return session
            ? { success: true, session }
            : { success: false, error: 'session not found', code: 'SESSION_NOT_FOUND' };
        },
      },
      metrics: { errors: 0 },
      logger: { info() {}, error() {} },
      activityLog: { log() {} },
      actorSouls: souls,
      symbolClaims,
      suggestions,
      agentInbox,
    },
  });
  return { app, souls, actors, sessionsById, symbolClaims, suggestions, sent };
}

function sameSymbolConflict(severity = 'blocking', type = 'direct', chain) {
  return (a, b) => {
    const requested = a.find((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes');
    const held = b.find((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes');
    if (!requested || !held) return [];
    return [{
      type,
      severity,
      confidence: severity === 'blocking' ? 1 : 0.8,
      a: requested,
      b: held,
      ...(chain ? { chain } : {}),
    }];
  };
}

async function claimCreateRoutes(harness, sessionId, type = 'modify') {
  const actor = harness.actors[sessionId];
  return harness.app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/symbols`,
    headers: actor.headers,
    payload: {
      agentId: actor.alias,
      claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type }],
    },
  });
}

describe('POST /sessions/:id/symbols', () => {
  test('claims a modify and returns the auto-derived blast radius', async () => {
    const harness = buildApp();
    const { app, actors } = harness;
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: actors.s1.headers,
      payload: {
        agentId: actors.s1.alias,
        claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.autoDerived.map((c) => c.symbolPath)).toEqual(['registerRoutes']);

    const list = await app.inject({ method: 'GET', url: '/sessions/s1/symbols' });
    expect(list.json().count).toBe(2);
    await app.close();
  });

  test('400 when a claim is missing filePath/symbolPath', async () => {
    const { app, actors } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: actors.s1.headers,
      payload: { claims: [{ filePath: 'x' }] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('400 when claims is empty', async () => {
    const { app, actors } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: actors.s1.headers,
      payload: { claims: [] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('anonymous and cross-actor callers cannot create symbol claims for a chosen session', async () => {
    const { app, actors, symbolClaims } = buildApp();
    const payload = {
      claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }],
    };

    const anonymous = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      payload,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().code).toBe('IDENTITY_CREDENTIAL_REQUIRED');

    const crossActor = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: actors.s2.headers,
      payload,
    });
    expect(crossActor.statusCode).toBe(403);
    expect(crossActor.json().code).toBe('SESSION_OWNERSHIP_MISMATCH');

    const forgedAlias = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: actors.s2.headers,
      payload: { ...payload, agentId: actors.s1.alias },
    });
    expect(forgedAlias.statusCode).toBe(403);
    expect(forgedAlias.json().code).toBe('IDENTITY_ALIAS_MISMATCH');
    expect(symbolClaims.list('s1')).toHaveLength(0);
    await app.close();
  });

  test('an unstamped legacy session cannot recover symbol-claim authority', async () => {
    const { app, actors, sessionsById, symbolClaims } = buildApp();
    sessionsById.set('legacy', {
      id: 'legacy',
      status: 'active',
      agentId: actors.s1.actorId,
      purpose: 'legacy symbol session',
      metadata: { displayIdentity: actors.s1.alias },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sessions/legacy/symbols',
      headers: actors.s1.headers,
      payload: {
        claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }],
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('SESSION_IDENTITY_UNVERIFIED');
    expect(symbolClaims.list('legacy')).toHaveLength(0);
    await app.close();
  });

  test('blocking conflict keeps the 409 verdict and emits complete durable advice', async () => {
    const harness = buildApp({ predictConflicts: sameSymbolConflict() });
    const { app, actors, suggestions, sent } = harness;

    const res1 = await claimCreateRoutes(harness, 's1');
    expect(res1.statusCode).toBe(200);

    const res2 = await claimCreateRoutes(harness, 's2');
    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('BLOCKING_CONFLICT');
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts[0].severity).toBe('blocking');

    const advice = suggestions.list({ agentId: actors.s2.actorId });
    expect(advice).toHaveLength(1);
    expect(advice[0].payload).toMatchObject({
      source: 'symbol-claim-flow',
      disposition: 'blocked',
      severity: 'blocking',
      surface: { filePath: 'lib/server.ts', symbolPath: 'createRoutes' },
      requester: { sessionId: 's2', agentId: actors.s2.actorId },
      holder: { sessionId: 's1', agentId: actors.s1.actorId },
      dependencyContext: null,
      action: {
        kind: 'parley-or-handoff',
        parley: { label: 'Open a parley' },
        handoff: { label: 'Request a handoff' },
      },
    });
    expect(advice[0].payload.reason).toContain('direct conflict');
    expect(advice[0].payload.action.parley.command).toBe('pd');
    expect(advice[0].payload.action.parley.argv).toEqual(expect.arrayContaining([
      'parley', 'call', '--surface', 'lib/server.ts#createRoutes',
    ]));
    expect(advice[0].payload.action.handoff.command).toBe('pd');
    expect(advice[0].payload.action.handoff.argv).toEqual(expect.arrayContaining([
      'inbox', 'send', actors.s1.actorId,
    ]));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      agentId: actors.s2.actorId,
      options: { from: 'suggestion-broker', type: 'suggestion' },
    });

    await app.close();
  });

  test('warning conflict preserves the successful claim and includes dependency context', async () => {
    const chain = ['lib/server.ts#createRoutes', 'lib/routes.ts#registerRoutes'];
    const harness = buildApp({
      predictConflicts: sameSymbolConflict('warning', 'dependency', chain),
    });
    const { app, actors, suggestions, sent } = harness;

    expect((await claimCreateRoutes(harness, 's1')).statusCode).toBe(200);
    const response = await claimCreateRoutes(harness, 's2');
    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts[0].severity).toBe('warning');

    const advice = suggestions.list({ agentId: actors.s2.actorId });
    expect(advice).toHaveLength(1);
    expect(advice[0].confidence).toBeLessThan(0.95);
    expect(advice[0].payload).toMatchObject({
      disposition: 'advisory',
      severity: 'warning',
      dependencyContext: { conflictType: 'dependency', chain },
      holder: { sessionId: 's1', agentId: actors.s1.actorId },
    });
    expect(sent).toHaveLength(1);

    await app.close();
  });

  test('repeated conflict advice is deduplicated by the existing suggestion cooldown', async () => {
    const harness = buildApp({ predictConflicts: sameSymbolConflict() });
    const { app, actors, suggestions, sent } = harness;

    expect((await claimCreateRoutes(harness, 's1')).statusCode).toBe(200);
    expect((await claimCreateRoutes(harness, 's2')).statusCode).toBe(409);
    expect((await claimCreateRoutes(harness, 's2')).statusCode).toBe(409);

    expect(suggestions.list({ agentId: actors.s2.actorId })).toHaveLength(1);
    expect(sent).toHaveLength(1);

    await app.close();
  });

  test('no conflict creates no suggestion and sends no inbox message', async () => {
    const harness = buildApp();
    const { app, actors, suggestions, sent } = harness;

    expect((await claimCreateRoutes(harness, 's1')).statusCode).toBe(200);
    expect((await claimCreateRoutes(harness, 's2')).statusCode).toBe(200);
    expect(suggestions.list({ agentId: actors.s2.actorId })).toHaveLength(0);
    expect(sent).toHaveLength(0);

    await app.close();
  });
});
