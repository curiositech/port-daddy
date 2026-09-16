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
  const actorSouls = createTestActorSouls(db);
  const owners = new Map();
  const ownerFor = (id) => {
    if (!owners.has(id)) owners.set(id, mintTestActor(actorSouls, `agent-${id}`));
    return owners.get(id);
  };
  const headersFor = (id) => ownerFor(id).headers;
  const sent = [];
  const symbolIndex = {
    getDependents: (f, s) => EDGES.filter((e) => e.targetFile === f && e.targetSymbol === s).map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType })),
    predictConflicts,
  };
  const sessionFor = (id) => ({
    id,
    agentId: `agent-${id}`,
    purpose: `purpose-${id}`,
    status: 'active',
    metadata: { identity: { verified: true, actorId: ownerFor(id).actorId } },
  });
  const symbolClaims = createSymbolClaims(db, {
    symbolIndex,
    now: () => 1000,
    agentForSession: (id) => sessionFor(id).agentId,
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
      sessions: { get: (id) => ({ success: true, session: sessionFor(id) }) },
      metrics: { errors: 0 },
      logger: { info() {}, error() {} },
      activityLog: { log() {} },
      symbolClaims,
      suggestions,
      agentInbox,
      actorSouls,
    },
  });
  const claim = (sessionId, type = 'modify', headers = headersFor(sessionId)) =>
    claimCreateRoutes(app, sessionId, headers, type);
  return { app, symbolClaims, suggestions, sent, headersFor, claim };
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

async function claimCreateRoutes(app, sessionId, headers, type = 'modify') {
  return app.inject({
    method: 'POST',
    url: `/sessions/${sessionId}/symbols`,
    headers,
    payload: { claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type }] },
  });
}

describe('POST /sessions/:id/symbols', () => {
  test('claims a modify and returns the auto-derived blast radius', async () => {
    const { app, headersFor } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      headers: headersFor('s1'),
      payload: { claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }] },
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
    const { app, headersFor } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/sessions/s1/symbols', headers: headersFor('s1'), payload: { claims: [{ filePath: 'x' }] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('400 when claims is empty', async () => {
    const { app, headersFor } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/sessions/s1/symbols', headers: headersFor('s1'), payload: { claims: [] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('blocking conflict keeps the 409 verdict and emits complete durable advice', async () => {
    const { app, claim, suggestions, sent } = buildApp({ predictConflicts: sameSymbolConflict() });

    const res1 = await claim('s1');
    expect(res1.statusCode).toBe(200);

    const res2 = await claim('s2');
    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('BLOCKING_CONFLICT');
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts[0].severity).toBe('blocking');

    const advice = suggestions.list({ agentId: 'agent-s2' });
    expect(advice).toHaveLength(1);
    expect(advice[0].payload).toMatchObject({
      source: 'symbol-claim-flow',
      disposition: 'blocked',
      severity: 'blocking',
      surface: { filePath: 'lib/server.ts', symbolPath: 'createRoutes' },
      requester: { sessionId: 's2', agentId: 'agent-s2' },
      holder: { sessionId: 's1', agentId: 'agent-s1' },
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
      'inbox', 'send', 'agent-s1',
    ]));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      agentId: 'agent-s2',
      options: { from: 'suggestion-broker', type: 'suggestion' },
    });

    await app.close();
  });

  test('warning conflict preserves the successful claim and includes dependency context', async () => {
    const chain = ['lib/server.ts#createRoutes', 'lib/routes.ts#registerRoutes'];
    const { app, claim, suggestions, sent } = buildApp({
      predictConflicts: sameSymbolConflict('warning', 'dependency', chain),
    });

    expect((await claim('s1')).statusCode).toBe(200);
    const response = await claim('s2');
    expect(response.statusCode).toBe(200);
    expect(response.json().conflicts[0].severity).toBe('warning');

    const advice = suggestions.list({ agentId: 'agent-s2' });
    expect(advice).toHaveLength(1);
    expect(advice[0].confidence).toBeLessThan(0.95);
    expect(advice[0].payload).toMatchObject({
      disposition: 'advisory',
      severity: 'warning',
      dependencyContext: { conflictType: 'dependency', chain },
      holder: { sessionId: 's1', agentId: 'agent-s1' },
    });
    expect(sent).toHaveLength(1);

    await app.close();
  });

  test('repeated conflict advice is deduplicated by the existing suggestion cooldown', async () => {
    const { app, claim, suggestions, sent } = buildApp({ predictConflicts: sameSymbolConflict() });

    expect((await claim('s1')).statusCode).toBe(200);
    expect((await claim('s2')).statusCode).toBe(409);
    expect((await claim('s2')).statusCode).toBe(409);

    expect(suggestions.list({ agentId: 'agent-s2' })).toHaveLength(1);
    expect(sent).toHaveLength(1);

    await app.close();
  });

  test('no conflict creates no suggestion and sends no inbox message', async () => {
    const { app, claim, suggestions, sent } = buildApp();

    expect((await claim('s1')).statusCode).toBe(200);
    expect((await claim('s2')).statusCode).toBe(200);
    expect(suggestions.list({ agentId: 'agent-s2' })).toHaveLength(0);
    expect(sent).toHaveLength(0);

    await app.close();
  });

  test.each([
    ['missing credential', () => ({}), 401, 'IDENTITY_CREDENTIAL_REQUIRED'],
    ['another session owner', (headersFor) => headersFor('s1'), 403, 'SESSION_AGENT_MISMATCH'],
  ])('%s cannot create claims or conflict advice', async (_label, requestHeaders, status, code) => {
    const { app, claim, headersFor, symbolClaims, suggestions, sent } = buildApp({
      predictConflicts: sameSymbolConflict(),
    });
    try {
      expect((await claim('s1')).statusCode).toBe(200);
      const before = symbolClaims.listAllActive();
      const denied = await claim('s2', 'modify', requestHeaders(headersFor));

      expect(denied.statusCode).toBe(status);
      expect(denied.json().code).toBe(code);
      expect(symbolClaims.listAllActive()).toEqual(before);
      expect(symbolClaims.list('s2')).toEqual([]);
      expect(suggestions.list({ agentId: 'agent-s2' })).toEqual([]);
      expect(sent).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
