import { createTestDb } from '../setup-unit.js';
import { createSymbolClaims } from '../../lib/symbol-claims.js';

// Reverse-dep graph: registerRoutes & healthCheck call createRoutes; main calls registerRoutes.
const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/health.ts', sourceSymbol: 'healthCheck', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/app.ts', sourceSymbol: 'main', targetFile: 'lib/routes.ts', targetSymbol: 'registerRoutes', dependencyType: 'calls' },
];

function makeSymbolIndex(predict = () => []) {
  return {
    getDependents: (filePath, symbolPath) =>
      EDGES.filter((e) => e.targetFile === filePath && e.targetSymbol === symbolPath).map((e) => ({
        sourceFile: e.sourceFile,
        sourceSymbol: e.sourceSymbol,
        dependencyType: e.dependencyType,
      })),
    predictConflicts: predict,
  };
}

let db;
let clock;

beforeEach(() => {
  db = createTestDb();
  clock = 1000;
});
afterEach(() => db.close());

describe('auto-claim loop', () => {
  test('a modify-claim auto-reserves read-claims over its blast radius', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    const res = claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }]);

    // the explicit modify + read-claims on registerRoutes, healthCheck (d1), main (d2)
    const all = claims.list('s1');
    const byKey = Object.fromEntries(all.map((c) => [`${c.symbolPath}`, c.type]));
    expect(byKey).toEqual({ createRoutes: 'modify', registerRoutes: 'read', healthCheck: 'read', main: 'read' });
    // the radius claims are flagged auto-derived + point at their origin
    expect(res.autoDerived.map((c) => c.symbolPath).sort()).toEqual(['healthCheck', 'main', 'registerRoutes']);
    expect(res.autoDerived.every((c) => c.derivedFrom === 'lib/server.ts::createRoutes')).toBe(true);
  });

  test('autoDeriveRadius:false records only the explicit claim', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { autoDeriveRadius: false });
    expect(claims.list('s1').map((c) => c.symbolPath)).toEqual(['createRoutes']);
  });

  test('radiusDepth bounds how far the auto-reservation reaches', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { radiusDepth: 1 });
    // depth 1 → only direct callers, not main (distance 2)
    expect(claims.list('s1').map((c) => c.symbolPath).sort()).toEqual(['createRoutes', 'healthCheck', 'registerRoutes']);
  });

  test('explicit modify dominates an auto-derived read on the same symbol', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    // modify createRoutes AND modify registerRoutes (which would also be auto-read from createRoutes)
    claims.claim('s1', [
      { filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' },
      { filePath: 'lib/routes.ts', symbolPath: 'registerRoutes', type: 'modify' },
    ]);
    const reg = claims.list('s1').find((c) => c.symbolPath === 'registerRoutes');
    expect(reg.type).toBe('modify');
    expect(reg.autoDerived).toBe(false);
  });

  test('idempotent — re-claiming a held symbol does not duplicate', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { autoDeriveRadius: false });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { autoDeriveRadius: false });
    expect(claims.list('s1')).toHaveLength(1);
  });
});

describe('cross-session conflict detection', () => {
  test('claiming returns conflicts predicted against other active sessions', () => {
    // fake predictConflicts: a direct conflict whenever both sets share createRoutes
    const predict = (mine, theirs) => {
      const m = mine.find((c) => c.symbolPath === 'createRoutes');
      const t = theirs.find((c) => c.symbolPath === 'createRoutes');
      return m && t ? [{ type: 'direct', severity: 'blocking', confidence: 1.0, a: m, b: t }] : [];
    };
    const claims = createSymbolClaims(db, {
      symbolIndex: makeSymbolIndex(predict),
      now: () => clock,
      agentForSession: (s) => (s === 's2' ? 'agent-2' : null),
    });
    claims.claim('s2', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { autoDeriveRadius: false });
    const res = claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }], { autoDeriveRadius: false });
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ type: 'direct', severity: 'blocking', otherSessionId: 's2', otherAgentId: 'agent-2' });
  });

  test('conflicts fire against AUTO-DERIVED radius claims (the Silent Consumer caught)', () => {
    // s2 modifies a symbol; s1 modifies createRoutes whose radius includes that symbol →
    // s1 holds a read on registerRoutes; s2 modifies registerRoutes → conflict.
    const predict = (mine, theirs) => {
      const out = [];
      for (const m of mine) for (const t of theirs) {
        if (m.symbolPath === t.symbolPath && (m.type === 'modify' || t.type === 'modify') && !(m.type === t.type && m.type === 'read')) {
          out.push({ type: 'direct', severity: m.type === 'read' || t.type === 'read' ? 'warning' : 'blocking', confidence: 0.9, a: m, b: t });
        }
      }
      return out;
    };
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(predict), now: () => clock });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }]); // auto-reads registerRoutes
    const res = claims.claim('s2', [{ filePath: 'lib/routes.ts', symbolPath: 'registerRoutes', type: 'modify' }], { autoDeriveRadius: false });
    // s2's modify of registerRoutes conflicts with s1's auto-derived read of it
    expect(res.conflicts.some((c) => c.b.symbolPath === 'registerRoutes' || c.a.symbolPath === 'registerRoutes')).toBe(true);
  });
});

describe('release', () => {
  test('release frees a session’s claims and removes them from conflict scope', () => {
    const claims = createSymbolClaims(db, { symbolIndex: makeSymbolIndex(), now: () => clock });
    claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }]);
    expect(claims.list('s1').length).toBeGreaterThan(0);
    const freed = claims.release('s1');
    expect(freed).toBeGreaterThan(0);
    expect(claims.list('s1')).toHaveLength(0);
    expect(claims.listAllActive()).toHaveLength(0);
  });
});
