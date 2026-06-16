import { computeBlastRadius, blastRadiusToReadClaims } from '../../lib/blast-radius.js';

// A tiny reverse-dependency graph as a fake `getDependents`.
// Edges (dependent → target): registerRoutes → createRoutes; app.main → registerRoutes;
// healthCheck → createRoutes. So createRoutes' radius is {registerRoutes(1), healthCheck(1), app.main(2)}.
function fakeDeps(edges) {
  // edges: array of { sourceFile, sourceSymbol, targetFile, targetSymbol, dependencyType }
  return {
    getDependents(filePath, symbolPath) {
      return edges
        .filter((e) => e.targetFile === filePath && e.targetSymbol === symbolPath)
        .map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType }));
    },
  };
}

const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/health.ts', sourceSymbol: 'healthCheck', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/app.ts', sourceSymbol: 'main', targetFile: 'lib/routes.ts', targetSymbol: 'registerRoutes', dependencyType: 'calls' },
];

describe('computeBlastRadius', () => {
  test('returns direct + transitive dependents with shortest distance', () => {
    const radius = computeBlastRadius(fakeDeps(EDGES), { filePath: 'lib/server.ts', symbolPath: 'createRoutes' }, 3);
    const byKey = Object.fromEntries(radius.map((n) => [`${n.filePath}::${n.symbolPath}`, n.distance]));
    expect(byKey).toEqual({
      'lib/routes.ts::registerRoutes': 1,
      'lib/health.ts::healthCheck': 1,
      'lib/app.ts::main': 2,
    });
  });

  test('respects maxDepth — depth 1 yields only direct callers', () => {
    const radius = computeBlastRadius(fakeDeps(EDGES), { filePath: 'lib/server.ts', symbolPath: 'createRoutes' }, 1);
    expect(radius.map((n) => n.symbolPath).sort()).toEqual(['healthCheck', 'registerRoutes']);
  });

  test('a leaf symbol nobody calls has an empty blast radius (dead-code signal)', () => {
    expect(computeBlastRadius(fakeDeps(EDGES), { filePath: 'lib/app.ts', symbolPath: 'main' }, 3)).toEqual([]);
  });

  test('handles cycles without infinite loop and dedups re-visits', () => {
    const cyclic = [
      { sourceFile: 'a.ts', sourceSymbol: 'A', targetFile: 'b.ts', targetSymbol: 'B', dependencyType: 'calls' },
      { sourceFile: 'b.ts', sourceSymbol: 'B', targetFile: 'a.ts', targetSymbol: 'A', dependencyType: 'calls' },
    ];
    const radius = computeBlastRadius(fakeDeps(cyclic), { filePath: 'a.ts', symbolPath: 'A' }, 5);
    expect(radius).toEqual([{ filePath: 'b.ts', symbolPath: 'B', distance: 1, via: 'calls' }]);
  });

  test('skips file-level / unresolved dependents (no source symbol)', () => {
    const withFileDep = [
      { sourceFile: 'x.ts', sourceSymbol: null, targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'imports' },
      ...EDGES,
    ];
    const radius = computeBlastRadius(fakeDeps(withFileDep), { filePath: 'lib/server.ts', symbolPath: 'createRoutes' }, 3);
    expect(radius.some((n) => n.symbolPath === null)).toBe(false);
    expect(radius).toHaveLength(3);
  });
});

describe('blastRadiusToReadClaims', () => {
  test('reserves a modify on the target + a read on every downstream symbol', () => {
    const target = { filePath: 'lib/server.ts', symbolPath: 'createRoutes' };
    const radius = computeBlastRadius(fakeDeps(EDGES), target, 3);
    const claims = blastRadiusToReadClaims(target, radius);
    expect(claims[0]).toEqual({ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' });
    const reads = claims.filter((c) => c.type === 'read').map((c) => c.symbolPath).sort();
    expect(reads).toEqual(['healthCheck', 'main', 'registerRoutes']);
  });

  test('never double-claims the target if it appears in its own radius (cycle)', () => {
    const target = { filePath: 'a.ts', symbolPath: 'A' };
    const radius = [{ filePath: 'a.ts', symbolPath: 'A', distance: 2, via: 'calls' }]; // target reachable from itself
    const claims = blastRadiusToReadClaims(target, radius);
    expect(claims).toEqual([{ filePath: 'a.ts', symbolPath: 'A', type: 'modify' }]);
  });
});
