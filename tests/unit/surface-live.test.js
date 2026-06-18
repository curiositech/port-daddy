import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';
import { resolveSurfaceSessions, runLiveSurfaceScan } from '../../lib/surface-live.js';

describe('resolveSurfaceSessions (pure)', () => {
  const worktrees = [
    { id: 'wt-a', root: '/work/a' },
    { id: 'wt-b', root: '/work/b' },
  ];

  test('maps a session worktreeId → its worktree path', () => {
    const out = resolveSurfaceSessions(
      [
        { id: 's1', agentId: 'agent-1', purpose: 'x', worktreeId: 'wt-a' },
        { id: 's2', agentId: 'agent-2', purpose: 'y', worktreeId: 'wt-b' },
      ],
      worktrees,
    );
    expect(out).toEqual([
      { sessionId: 's1', agentId: 'agent-1', purpose: 'x', worktreePath: '/work/a' },
      { sessionId: 's2', agentId: 'agent-2', purpose: 'y', worktreePath: '/work/b' },
    ]);
  });

  test('drops sessions with no worktree or an unknown worktree (nothing to diff)', () => {
    const out = resolveSurfaceSessions(
      [
        { id: 's1', agentId: null, purpose: 'x', worktreeId: null },
        { id: 's2', agentId: null, purpose: 'y', worktreeId: 'gone' },
        { id: 's3', agentId: null, purpose: 'z', worktreeId: 'wt-a' },
      ],
      worktrees,
    );
    expect(out.map((s) => s.sessionId)).toEqual(['s3']);
  });
});

describe('runLiveSurfaceScan', () => {
  test('resolves live sessions, reads their diffs, and surfaces conflicts', async () => {
    const db = createTestDb();
    try {
      const suggestions = createSuggestions(db, { now: () => 1000 });
      const sent = [];
      const inbox = { send: (agentId) => (sent.push({ agentId }), { success: true }) };

      const diffA = [
        'diff --git a/lib/server.ts b/lib/server.ts',
        '--- a/lib/server.ts',
        '+++ b/lib/server.ts',
        '@@ -11,1 +11,2 @@ export function createRoutes(app, db) {',
        '+  r.use(cache);',
      ].join('\n');
      const diffB = [
        'diff --git a/lib/app.ts b/lib/app.ts',
        '--- a/lib/app.ts',
        '+++ b/lib/app.ts',
        '@@ -4,1 +4,1 @@ export function registerRoutes(app) {',
        '+  createRoutes(app, database, cache);',
      ].join('\n');

      const symbolsByFile = {
        'lib/server.ts': [{ symbolPath: 'createRoutes', symbolType: 'function', startLine: 10, endLine: 20 }],
        'lib/app.ts': [{ symbolPath: 'registerRoutes', symbolType: 'function', startLine: 3, endLine: 6 }],
      };
      const symbolIndex = {
        async parseFile() {},
        getSymbols: (f) => symbolsByFile[Object.keys(symbolsByFile).find((k) => f.endsWith(k))] ?? [],
        predictConflicts: (a, b) => (a.length && b.length ? [{ type: 'signature', severity: 'blocking', confidence: 0.9, a: a[0], b: b[0] }] : []),
      };

      const res = await runLiveSurfaceScan({
        listActiveSessions: () => [
          { id: 's1', agentId: 'agent-1', purpose: 'cache', worktreeId: 'wt-a' },
          { id: 's2', agentId: 'agent-2', purpose: 'routes', worktreeId: 'wt-b' },
        ],
        listWorktrees: () => [
          { id: 'wt-a', root: '/work/a' },
          { id: 'wt-b', root: '/work/b' },
        ],
        getDiff: (wt) => (wt === '/work/a' ? diffA : diffB),
        symbolIndex,
        suggestions,
        inbox,
      });

      expect(res).toMatchObject({ sessions: 2, conflicts: 1, surfaced: 2, delivered: 2 });
      expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    } finally {
      db.close();
    }
  });

  test('no active sessions with worktrees → empty scan, no work', async () => {
    const db = createTestDb();
    try {
      const suggestions = createSuggestions(db, { now: () => 1000 });
      const res = await runLiveSurfaceScan({
        listActiveSessions: () => [{ id: 's1', agentId: null, purpose: 'x', worktreeId: null }],
        listWorktrees: () => [],
        getDiff: () => '',
        symbolIndex: { async parseFile() {}, getSymbols: () => [], predictConflicts: () => [] },
        suggestions,
        inbox: { send: () => ({ success: true }) },
      });
      expect(res).toMatchObject({ sessions: 0, conflicts: 0 });
    } finally {
      db.close();
    }
  });
});
