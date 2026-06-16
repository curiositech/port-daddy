import Fastify from 'fastify';
import { createTestDb } from '../setup-unit.js';
import { createSymbolClaims } from '../../lib/symbol-claims.js';

const { sessionsPlugin } = await import('../../routes/sessions.js');

const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
];

function buildApp() {
  const app = Fastify();
  const db = createTestDb();
  const symbolIndex = {
    getDependents: (f, s) => EDGES.filter((e) => e.targetFile === f && e.targetSymbol === s).map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType })),
    predictConflicts: () => [],
  };
  const symbolClaims = createSymbolClaims(db, { symbolIndex, now: () => 1000 });
  app.addHook('onClose', () => db.close());
  app.register(sessionsPlugin, {
    deps: {
      sessions: {},
      metrics: { errors: 0 },
      logger: { info() {}, error() {} },
      activityLog: { log() {} },
      symbolClaims,
    },
  });
  return { app, symbolClaims };
}

describe('POST /sessions/:id/symbols', () => {
  test('claims a modify and returns the auto-derived blast radius', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
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
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/sessions/s1/symbols', payload: { claims: [{ filePath: 'x' }] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('400 when claims is empty', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'POST', url: '/sessions/s1/symbols', payload: { claims: [] } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
