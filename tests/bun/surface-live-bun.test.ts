/** runLiveSurfaceScan under the daemon runtime (bun:sqlite) — the suggestions store path. */
import { beforeEach, afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createSuggestions } from '../../lib/suggestions.ts';
import { runLiveSurfaceScan } from '../../lib/surface-live.ts';

let db: Database;
beforeEach(() => { db = new Database(':memory:'); });
afterEach(() => db.close());

describe('runLiveSurfaceScan under bun:sqlite', () => {
  test('resolves sessions, surfaces a conflict to the store', async () => {
    const suggestions = createSuggestions(db, { now: () => 1000 });
    const sent: string[] = [];
    const diff = (s: string) => [`diff --git a/lib/${s}.ts b/lib/${s}.ts`, `--- a/lib/${s}.ts`, `+++ b/lib/${s}.ts`, `@@ -11,1 +11,2 @@ export function fn() {`, '+ x();'].join('\n');
    const res = await runLiveSurfaceScan({
      listActiveSessions: () => [
        { id: 's1', agentId: 'a1', purpose: 'p', worktreeId: 'wA' },
        { id: 's2', agentId: 'a2', purpose: 'p', worktreeId: 'wB' },
      ],
      listWorktrees: () => [{ id: 'wA', root: '/a' }, { id: 'wB', root: '/b' }],
      getDiff: (wt: string) => (wt === '/a' ? diff('server') : diff('app')),
      symbolIndex: {
        async parseFile() {},
        getSymbols: (f: string) => [{ symbolPath: 'fn', symbolType: 'function', startLine: 10, endLine: 20 }],
        predictConflicts: (a: unknown[], b: unknown[]) => (a.length && b.length ? [{ type: 'direct', severity: 'blocking', confidence: 1, a: (a as any)[0], b: (b as any)[0] }] : []),
      } as never,
      suggestions,
      inbox: { send: (id: string) => (sent.push(id), { success: true }) },
    });
    expect(res.sessions).toBe(2);
    expect(res.conflicts).toBe(1);
    expect(sent.sort()).toEqual(['a1', 'a2']);
  });
});
