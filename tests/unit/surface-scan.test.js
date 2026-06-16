import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';
import {
  touchedRegionsToClaims,
  severityToConfidence,
  runSurfaceScan,
} from '../../lib/surface-scan.js';

describe('touchedRegionsToClaims (pure)', () => {
  test('maps symbol regions to modify-claims, drops null-symbol regions, dedups', () => {
    const claims = touchedRegionsToClaims([
      { filePath: 'lib/a.ts', symbolPath: 'foo', symbolKind: 'function', startLine: 1, endLine: 9 },
      { filePath: 'lib/a.ts', symbolPath: 'foo', symbolKind: 'function', startLine: 1, endLine: 9 }, // dup
      { filePath: 'lib/a.ts', symbolPath: null, symbolKind: null, startLine: 1, endLine: 1 }, // import edit → drop
      { filePath: 'lib/b.ts', symbolPath: 'Bar.baz', symbolKind: 'method', startLine: 5, endLine: 8 },
    ]);
    expect(claims).toEqual([
      { filePath: 'lib/a.ts', symbolPath: 'foo', type: 'modify' },
      { filePath: 'lib/b.ts', symbolPath: 'Bar.baz', type: 'modify' },
    ]);
  });
});

describe('severityToConfidence', () => {
  test('blocking → priority (>=0.95), warning → 0.9, info → 0.6', () => {
    expect(severityToConfidence('blocking')).toBeGreaterThanOrEqual(0.95);
    expect(severityToConfidence('warning')).toBe(0.9);
    expect(severityToConfidence('info')).toBe(0.6);
  });
});

describe('runSurfaceScan', () => {
  let db;
  let suggestions;
  let sent;
  let inbox;

  // a real `git diff -U0` touching lib/server.ts around line 11
  const diffA = [
    'diff --git a/lib/server.ts b/lib/server.ts',
    'index 1111111..2222222 100644',
    '--- a/lib/server.ts',
    '+++ b/lib/server.ts',
    '@@ -11,1 +11,2 @@ export function createRoutes(app, db) {',
    '-  const r = express.Router();',
    '+  const r = express.Router();',
    '+  r.use(cache);',
  ].join('\n');
  // a real `git diff -U0` touching lib/app.ts around line 4
  const diffB = [
    'diff --git a/lib/app.ts b/lib/app.ts',
    'index 3333333..4444444 100644',
    '--- a/lib/app.ts',
    '+++ b/lib/app.ts',
    '@@ -4,1 +4,1 @@ export function registerRoutes(app) {',
    '-  createRoutes(app, database);',
    '+  createRoutes(app, database, cache);',
  ].join('\n');

  const symbolsByFile = {
    'lib/server.ts': [{ symbolPath: 'createRoutes', symbolType: 'function', startLine: 10, endLine: 20 }],
    'lib/app.ts': [{ symbolPath: 'registerRoutes', symbolType: 'function', startLine: 3, endLine: 6 }],
  };

  function makeSymbolIndex(predict) {
    return {
      async parseFile() {},
      getSymbols: (f) => symbolsByFile[f] ?? [],
      predictConflicts: predict,
    };
  }

  const sessions = [
    { sessionId: 's1', agentId: 'agent-1', purpose: 'add cache', worktreePath: '/wt/a' },
    { sessionId: 's2', agentId: 'agent-2', purpose: 'wire routes', worktreePath: '/wt/b' },
  ];
  const getDiff = (wt) => (wt === '/wt/a' ? diffA : diffB);

  beforeEach(() => {
    db = createTestDb();
    suggestions = createSuggestions(db, { now: () => 1000 });
    sent = [];
    inbox = { send: (agentId, content, options) => (sent.push({ agentId, content, options }), { success: true }) };
  });
  afterEach(() => db.close());

  test('bridges real edits → symbol claims → predictConflicts → surfaces to BOTH parties', async () => {
    // fake the rich engine: a signature conflict between the two sessions' modify-claims
    const predict = (a, b) =>
      a.length && b.length ? [{ type: 'signature', severity: 'blocking', confidence: 0.9, a: a[0], b: b[0] }] : [];

    const res = await runSurfaceScan({ sessions, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox });

    expect(res).toMatchObject({ sessions: 2, conflicts: 1, surfaced: 2, delivered: 2 });
    expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    // each side sees its own symbol as "yours" and the other's as "theirs"
    const toA = sent.find((m) => m.agentId === 'agent-1').content;
    expect(toA.conflictType).toBe('signature');
    expect(toA.yourSymbol).toContain('createRoutes');
    expect(toA.theirSymbol).toContain('registerRoutes');
    expect(toA.v).toBe(1);
  });

  test('a blocking conflict surfaces at PRIORITY confidence (routes past the trivial budget)', async () => {
    const predict = (a, b) =>
      a.length && b.length ? [{ type: 'direct', severity: 'blocking', confidence: 1.0, a: a[0], b: b[0] }] : [];
    await runSurfaceScan({ sessions, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox });
    const surfaced = suggestions.list({ agentId: 'agent-1' });
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('re-scanning a standing conflict is suppressed by cooldown (no inbox spam)', async () => {
    const predict = (a, b) =>
      a.length && b.length ? [{ type: 'signature', severity: 'blocking', confidence: 0.9, a: a[0], b: b[0] }] : [];
    const deps = { sessions, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox };
    const first = await runSurfaceScan(deps);
    expect(first.surfaced).toBe(2);
    const second = await runSurfaceScan(deps);
    expect(second).toMatchObject({ conflicts: 1, surfaced: 0, suppressed: 2 });
    expect(sent).toHaveLength(2);
  });

  test('no conflicts when a session has no symbol-level edits', async () => {
    const emptyDiff = (wt) => (wt === '/wt/a' ? diffA : ''); // session 2 has no diff
    const predict = (a, b) => (a.length && b.length ? [{ type: 'direct', severity: 'blocking', confidence: 1, a: a[0], b: b[0] }] : []);
    const res = await runSurfaceScan({ sessions, getDiff: emptyDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox });
    expect(res).toMatchObject({ conflicts: 0, surfaced: 0 });
    expect(sent).toHaveLength(0);
  });
});
