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

  test('409 when a blocking conflict exists with another session (ast-a2-1)', async () => {
    const app = Fastify();
    const db = createTestDb();
    const symbolIndex = {
      getDependents: (f, s) => EDGES.filter((e) => e.targetFile === f && e.targetSymbol === s).map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType })),
      predictConflicts: (a, b) => {
        // Simulate a blocking conflict: both sessions modify the same symbol
        if (a.some((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes' && c.type === 'modify') &&
            b.some((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes' && c.type === 'modify')) {
          return [{
            type: 'direct',
            severity: 'blocking',
            confidence: 1.0,
            a: a.find((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes'),
            b: b.find((c) => c.filePath === 'lib/server.ts' && c.symbolPath === 'createRoutes'),
          }];
        }
        return [];
      },
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

    // First session claims modify
    const res1 = await app.inject({
      method: 'POST',
      url: '/sessions/s1/symbols',
      payload: { claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }] },
    });
    expect(res1.statusCode).toBe(200);

    // Second session tries to claim the same modify — should be rejected with 409
    const res2 = await app.inject({
      method: 'POST',
      url: '/sessions/s2/symbols',
      payload: { claims: [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }] },
    });
    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('BLOCKING_CONFLICT');
    expect(body.conflicts.length).toBeGreaterThan(0);
    expect(body.conflicts[0].severity).toBe('blocking');

    await app.close();
  });
});
