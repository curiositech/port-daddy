/**
 * Regression test for symbol-claims under the SHIPPED runtime: bun:sqlite.
 * The auto-claim loop persists to the daemon's bun:sqlite store; this pins the
 * table + auto-derivation + release under the real engine.
 */
import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createSymbolClaims } from '../../lib/symbol-claims.ts';

const EDGES = [
  { sourceFile: 'lib/routes.ts', sourceSymbol: 'registerRoutes', targetFile: 'lib/server.ts', targetSymbol: 'createRoutes', dependencyType: 'calls' },
  { sourceFile: 'lib/app.ts', sourceSymbol: 'main', targetFile: 'lib/routes.ts', targetSymbol: 'registerRoutes', dependencyType: 'calls' },
];
const symbolIndex = {
  getDependents: (f: string, s?: string) =>
    EDGES.filter((e) => e.targetFile === f && e.targetSymbol === s).map((e) => ({ sourceFile: e.sourceFile, sourceSymbol: e.sourceSymbol, dependencyType: e.dependencyType })),
  predictConflicts: () => [],
};

let db: Database;
beforeEach(() => { db = new Database(':memory:'); });
afterEach(() => db.close());

describe('symbol-claims under bun:sqlite', () => {
  test('modify auto-reserves the blast radius and release frees it', () => {
    const claims = createSymbolClaims(db, { symbolIndex: symbolIndex as never, now: () => 1000 });
    const res = claims.claim('s1', [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', type: 'modify' }]);
    expect(res.claimed.length).toBe(3); // createRoutes(modify) + registerRoutes,main(read)
    expect(res.autoDerived.map((c) => c.symbolPath).sort()).toEqual(['main', 'registerRoutes']);
    expect(claims.release('s1')).toBe(3);
    expect(claims.listAllActive()).toHaveLength(0);
  });
});
