import Fastify from 'fastify';

const { symbolsPlugin } = await import('../../routes/symbols.js');

function buildApp(edges) {
  const app = Fastify();
  const symbolIndex = {
    getDependents(filePath, symbolPath) {
      return edges
        .filter((e) => e.targetFile === filePath && e.targetSymbol === symbolPath)
        .map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType }));
    },
  };
  app.register(symbolsPlugin, { deps: { symbolIndex, metrics: { errors: 0 }, logger: { info() {}, error() {} } } });
  return app;
}

const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/app.ts', sourceSymbol: 'main', targetFile: 'lib/routes.ts', targetSymbol: 'registerRoutes', dependencyType: 'calls' },
];

describe('GET /symbols/blast-radius', () => {
  test('returns the reverse-dependency closure + a reservable claim set', async () => {
    const app = buildApp(EDGES);
    const res = await app.inject({ method: 'GET', url: '/symbols/blast-radius?file=lib/server.ts&symbol=createRoutes&depth=3' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(2);
    expect(body.radius.map((n) => n.symbolPath).sort()).toEqual(['main', 'registerRoutes']);
    // a modify on the target + a read on each downstream symbol
    expect(body.claims[0]).toEqual({ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' });
    expect(body.claims.filter((c) => c.type === 'read')).toHaveLength(2);
    await app.close();
  });

  test('400 when file or symbol is missing', async () => {
    const app = buildApp(EDGES);
    const res = await app.inject({ method: 'GET', url: '/symbols/blast-radius?file=lib/server.ts' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test('clamps depth to [1,6] and tolerates non-numeric', async () => {
    const app = buildApp(EDGES);
    const r1 = await app.inject({ method: 'GET', url: '/symbols/blast-radius?file=lib/server.ts&symbol=createRoutes&depth=1' });
    expect(r1.json().radius.map((n) => n.symbolPath)).toEqual(['registerRoutes']); // depth 1 = direct only
    const r2 = await app.inject({ method: 'GET', url: '/symbols/blast-radius?file=lib/server.ts&symbol=createRoutes&depth=abc' });
    expect(r2.json().depth).toBe(3); // default
    await app.close();
  });
});
