/**
 * Regression test for surface-scan under the SHIPPED runtime: bun:sqlite.
 *
 * `runSurfaceScan` surfaces conflicts via `createSuggestions` (the daemon's bun:sqlite
 * store). This pins the conflict→suggestion path under the real engine — the jest suite
 * exercises the same logic under better-sqlite3.
 */

import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';

import { createSuggestions } from '../../lib/suggestions.ts';
import { runSurfaceScan } from '../../lib/surface-scan.ts';

let db: Database;

const diffA = [
  'diff --git a/lib/server.ts b/lib/server.ts',
  '--- a/lib/server.ts',
  '+++ b/lib/server.ts',
  '@@ -11,1 +11,2 @@ export function createRoutes(app, db) {',
  '-  const r = express.Router();',
  '+  r.use(cache);',
].join('\n');
const diffB = [
  'diff --git a/lib/app.ts b/lib/app.ts',
  '--- a/lib/app.ts',
  '+++ b/lib/app.ts',
  '@@ -4,1 +4,1 @@ export function registerRoutes(app) {',
  '-  createRoutes(app, database);',
  '+  createRoutes(app, database, cache);',
].join('\n');

const symbolsByFile: Record<string, Array<{ symbolPath: string; symbolType: string; startLine: number; endLine: number }>> = {
  'lib/server.ts': [{ symbolPath: 'createRoutes', symbolType: 'function', startLine: 10, endLine: 20 }],
  'lib/app.ts': [{ symbolPath: 'registerRoutes', symbolType: 'function', startLine: 3, endLine: 6 }],
};

beforeEach(() => {
  db = new Database(':memory:');
});
afterEach(() => db.close());

describe('runSurfaceScan under bun:sqlite', () => {
  test('bridges real edits → predictConflicts → suggestions store, delivers to both parties', async () => {
    const suggestions = createSuggestions(db, { now: () => 1000 });
    const sent: Array<{ agentId: string }> = [];
    const inbox = { send: (agentId: string) => (sent.push({ agentId }), { success: true }) };
    const symbolIndex = {
      async parseFile() {},
      getSymbols: (f: string) => symbolsByFile[f] ?? [],
      predictConflicts: (a: unknown[], b: unknown[]) =>
        a.length && b.length ? [{ type: 'signature', severity: 'blocking', confidence: 0.9, a: (a as any)[0], b: (b as any)[0] }] : [],
    };
    const res = await runSurfaceScan({
      sessions: [
        { sessionId: 's1', agentId: 'agent-1', purpose: 'a', worktreePath: '/wt/a' },
        { sessionId: 's2', agentId: 'agent-2', purpose: 'b', worktreePath: '/wt/b' },
      ],
      getDiff: (wt: string) => (wt === '/wt/a' ? diffA : diffB),
      symbolIndex: symbolIndex as never,
      suggestions,
      inbox,
    });
    expect(res.conflicts).toBe(1);
    expect(res.surfaced).toBe(2);
    expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    const surfaced = suggestions.list({ agentId: 'agent-1' });
    expect(surfaced[0].confidence).toBeGreaterThanOrEqual(0.95);
  });
});
