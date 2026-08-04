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
    'lib/server.ts': [{ filePath: 'lib/server.ts', symbolPath: 'createRoutes', symbolType: 'function', startLine: 10, endLine: 20 }],
    'lib/app.ts': [{ filePath: 'lib/app.ts', symbolPath: 'registerRoutes', symbolType: 'function', startLine: 3, endLine: 6 }],
  };

  function makeSymbolIndex(predict) {
    return {
      async parseFile() {},
      getSymbols: (f) => symbolsByFile[Object.keys(symbolsByFile).find((k) => f.endsWith(k))] ?? [],
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

  test('parses each diff file against the session WORKTREE path, not the daemon cwd (path fix)', async () => {
    // spy: record the paths parseFile/getSymbols are called with
    const parsedPaths = [];
    const gotPaths = [];
    const spyIndex = {
      async parseFile(p) { parsedPaths.push(p); },
      getSymbols: (p) => { gotPaths.push(p); return symbolsByFile['lib/server.ts'] ?? []; },
      predictConflicts: () => [],
    };
    await runSurfaceScan({
      sessions: [{ sessionId: 's1', agentId: 'a1', purpose: 'p', worktreePath: '/wt/a' }],
      getDiff: () => diffA, // touches lib/server.ts
      symbolIndex: spyIndex,
      suggestions,
      inbox,
    });
    // the diff's relative `lib/server.ts` must be resolved under the worktree root
    expect(parsedPaths).toContain('/wt/a/lib/server.ts');
    expect(gotPaths).toContain('/wt/a/lib/server.ts');
    // and NOT the bare relative path (which would resolve against the daemon cwd)
    expect(parsedPaths).not.toContain('lib/server.ts');
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

  test('without a symbolClaims dep the guard does not run (claimedSymbolHits: 0)', async () => {
    const res = await runSurfaceScan({ sessions, getDiff, symbolIndex: makeSymbolIndex(() => []), suggestions, inbox });
    expect(res.claimedSymbolHits).toBe(0);
  });

  describe('claim guard (edits vs DECLARED symbol claims)', () => {
    // Only session s1 diffs (edits createRoutes); the claim HOLDER has no worktree
    // at all — its claim is pure declared intent from `claim_symbols`, which the
    // old diff-vs-diff pass could never see.
    const soloEditor = [sessions[0]];
    // identity-only direct conflict, same semantics subset as the real matrix
    const predict = (a, b) => {
      const out = [];
      for (const ca of a) for (const cb of b) {
        if (ca.filePath === cb.filePath && ca.symbolPath === cb.symbolPath && ca.type !== 'read' && cb.type !== 'read') {
          out.push({ type: 'direct', severity: 'blocking', confidence: 1.0, a: ca, b: cb });
        }
      }
      return out;
    };

    test('edit landing on another session\'s declared modify-claim → guard hit surfaced to the editor', async () => {
      const symbolClaims = {
        listAllActive: () => [
          // the symbols table stores resolved absolutes; s1's regions resolve under /wt/a
          { sessionId: 'holder-session', filePath: '/wt/a/lib/server.ts', symbolPath: 'createRoutes', type: 'modify' },
        ],
      };
      const res = await runSurfaceScan({
        sessions: soloEditor, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox, symbolClaims,
      });

      expect(res.claimedSymbolHits).toBe(1);
      expect(res).toMatchObject({ conflicts: 0, surfaced: 1, delivered: 1 }); // no pairwise diff conflicts, one guard hit
      expect(sent).toHaveLength(1);
      const msg = sent[0];
      expect(msg.agentId).toBe('agent-1'); // delivered to the EDITOR
      expect(msg.content.guard).toBe('claim-guard');
      expect(msg.content.via).toBe('symbol-identity');
      expect(msg.content.claimedBy.sessionId).toBe('holder-session');
      expect(msg.content.claimedSymbol).toContain('createRoutes');
      expect(msg.content.message).toContain('holder-session'); // names the claim holder
      // stored suggestion is at blocking/priority confidence
      const surfaced = suggestions.list({ agentId: 'agent-1' });
      expect(surfaced).toHaveLength(1);
      expect(surfaced[0].confidence).toBeGreaterThanOrEqual(0.95);
    });

    test('re-scan of a standing guard hit is suppressed by the cooldown (distinct claim-guard hash)', async () => {
      const symbolClaims = {
        listAllActive: () => [
          { sessionId: 'holder-session', filePath: '/wt/a/lib/server.ts', symbolPath: 'createRoutes', type: 'modify' },
        ],
      };
      const deps = { sessions: soloEditor, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox, symbolClaims };
      const first = await runSurfaceScan(deps);
      expect(first).toMatchObject({ claimedSymbolHits: 1, surfaced: 1 });
      const second = await runSurfaceScan(deps);
      expect(second).toMatchObject({ claimedSymbolHits: 1, surfaced: 0, suppressed: 1 });
      expect(sent).toHaveLength(1); // no inbox spam
    });

    test('declared claim on an untouched symbol → no guard hit', async () => {
      const symbolClaims = {
        listAllActive: () => [
          { sessionId: 'holder-session', filePath: '/wt/a/lib/other.ts', symbolPath: 'unrelated', type: 'modify' },
        ],
      };
      const res = await runSurfaceScan({
        sessions: soloEditor, getDiff, symbolIndex: makeSymbolIndex(predict), suggestions, inbox, symbolClaims,
      });
      expect(res.claimedSymbolHits).toBe(0);
      expect(sent).toHaveLength(0);
    });
  });
});
