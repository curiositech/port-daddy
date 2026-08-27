import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';
import {
  detectClaimOverlaps,
  rangesOverlap,
  overlapPayloadHash,
  runOverlapScan,
  runClaimTreeTroubleScan,
} from '../../lib/suggestion-broker.js';

function claim(sessionId, filePath, opts = {}) {
  return {
    filePath,
    sessionId,
    purpose: opts.purpose ?? `purpose-${sessionId}`,
    agentId: opts.agentId ?? null,
    phase: 'in_progress',
    claimedAt: 1,
    startLine: opts.startLine ?? null,
    endLine: opts.endLine ?? null,
    symbol: null,
    symbolPath: opts.symbolPath ?? null,
  };
}

describe('rangesOverlap', () => {
  test('null range (whole-file) overlaps everything', () => {
    expect(rangesOverlap(null, null, 5, 10)).toBe(true);
    expect(rangesOverlap(5, 10, null, null)).toBe(true);
  });
  test('disjoint ranges do not overlap', () => {
    expect(rangesOverlap(1, 5, 6, 10)).toBe(false);
  });
  test('touching/overlapping ranges overlap', () => {
    expect(rangesOverlap(1, 6, 6, 10)).toBe(true);
    expect(rangesOverlap(1, 10, 4, 6)).toBe(true);
  });
});

describe('detectClaimOverlaps', () => {
  test('flags two distinct sessions on the same whole-file claim', () => {
    const overlaps = detectClaimOverlaps([
      claim('s1', 'lib/x.ts'),
      claim('s2', 'lib/x.ts'),
    ]);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].filePath).toBe('lib/x.ts');
    // unordered: lexicographically smaller sessionId is `a`
    expect(overlaps[0].a.sessionId).toBe('s1');
    expect(overlaps[0].b.sessionId).toBe('s2');
  });

  test('does not flag a session overlapping itself', () => {
    const overlaps = detectClaimOverlaps([
      claim('s1', 'lib/x.ts', { startLine: 1, endLine: 10 }),
      claim('s1', 'lib/x.ts', { startLine: 5, endLine: 20 }),
    ]);
    expect(overlaps).toHaveLength(0);
  });

  test('does not flag distinct sessions on disjoint line ranges', () => {
    const overlaps = detectClaimOverlaps([
      claim('s1', 'lib/x.ts', { startLine: 1, endLine: 5 }),
      claim('s2', 'lib/x.ts', { startLine: 6, endLine: 10 }),
    ]);
    expect(overlaps).toHaveLength(0);
  });

  test('flags distinct sessions on overlapping line ranges', () => {
    const overlaps = detectClaimOverlaps([
      claim('s1', 'lib/x.ts', { startLine: 1, endLine: 8 }),
      claim('s2', 'lib/x.ts', { startLine: 6, endLine: 12 }),
    ]);
    expect(overlaps).toHaveLength(1);
  });

  test('flags same-symbol claims, ignores different-symbol claims', () => {
    expect(
      detectClaimOverlaps([
        claim('s1', 'lib/x.ts', { symbolPath: 'Foo.bar' }),
        claim('s2', 'lib/x.ts', { symbolPath: 'Foo.bar' }),
      ]),
    ).toHaveLength(1);
    expect(
      detectClaimOverlaps([
        claim('s1', 'lib/x.ts', { symbolPath: 'Foo.bar' }),
        claim('s2', 'lib/x.ts', { symbolPath: 'Foo.baz' }),
      ]),
    ).toHaveLength(0);
  });

  test('different files never overlap', () => {
    expect(
      detectClaimOverlaps([claim('s1', 'lib/x.ts'), claim('s2', 'lib/y.ts')]),
    ).toHaveLength(0);
  });

  test('payload hash is stable regardless of session order', () => {
    const [o1] = detectClaimOverlaps([claim('s2', 'f'), claim('s1', 'f')]);
    const [o2] = detectClaimOverlaps([claim('s1', 'f'), claim('s2', 'f')]);
    expect(overlapPayloadHash(o1)).toBe(overlapPayloadHash(o2));
  });
});

describe('runOverlapScan', () => {
  let db;
  let suggestions;
  let sent;
  let inbox;

  beforeEach(() => {
    db = createTestDb();
    suggestions = createSuggestions(db, { now: () => 1000 });
    sent = [];
    inbox = {
      send(agentId, content, options) {
        sent.push({ agentId, content, options });
        return { success: true, messageId: sent.length };
      },
    };
  });
  afterEach(() => db.close());

  function sessionsWith(claims) {
    return { listAllActiveClaims: () => ({ success: true, claims, count: claims.length }) };
  }

  // S5 fix: severity drives confidence so the priority tier fires for the
  // overlaps that matter. A whole-file (null-range) collision is high-severity.
  test('a whole-file overlap is surfaced at PRIORITY confidence (>= 0.95)', () => {
    runOverlapScan({
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2' }),
      ]),
      suggestions,
      inbox,
    });
    const surfaced = suggestions.list({ agentId: 'agent-1' });
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('a partial line-range overlap is surfaced at NORMAL confidence (< 0.95)', () => {
    runOverlapScan({
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1', startLine: 1, endLine: 8 }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2', startLine: 6, endLine: 12 }),
      ]),
      suggestions,
      inbox,
    });
    const surfaced = suggestions.list({ agentId: 'agent-1' });
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0].confidence).toBeLessThan(0.95);
  });

  test('the delivered payload carries a wire-format version (schema-drift defense)', () => {
    runOverlapScan({
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2' }),
      ]),
      suggestions,
      inbox,
    });
    expect(sent[0].content.v).toBe(1);
    expect(suggestions.list({ agentId: 'agent-1' })[0].payload.v).toBe(1);
  });

  test('surfaces and delivers a heads-up to BOTH parties of an overlap', () => {
    const res = runOverlapScan({
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2' }),
      ]),
      suggestions,
      inbox,
    });
    expect(res).toMatchObject({ overlaps: 1, surfaced: 2, suppressed: 0, delivered: 2 });
    expect(sent.map((m) => m.agentId).sort()).toEqual(['agent-1', 'agent-2']);
    expect(sent[0].options).toMatchObject({ type: 'suggestion', from: 'suggestion-broker' });
    // each side sees the OTHER as `other`
    const toAgent1 = sent.find((m) => m.agentId === 'agent-1').content;
    expect(toAgent1.other.agentId).toBe('agent-2');
    expect(toAgent1.you.agentId).toBe('agent-1');
  });

  test('falls back to sessionId as the delivery key when agentId is null', () => {
    runOverlapScan({
      sessions: sessionsWith([claim('s1', 'lib/x.ts'), claim('s2', 'lib/x.ts')]),
      suggestions,
      inbox,
    });
    expect(sent.map((m) => m.agentId).sort()).toEqual(['s1', 's2']);
  });

  test('a second scan over the same standing overlap is suppressed by cooldown', () => {
    const deps = {
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2' }),
      ]),
      suggestions,
      inbox,
    };
    const first = runOverlapScan(deps);
    expect(first.surfaced).toBe(2);
    const second = runOverlapScan(deps);
    expect(second).toMatchObject({ overlaps: 1, surfaced: 0, suppressed: 2, delivered: 0 });
    // no duplicate inbox spam
    expect(sent).toHaveLength(2);
  });

  test('logs suppressed surfacings to the activity firehose for tuning', () => {
    const events = [];
    const activityLog = { log: (type, detail) => events.push({ type, detail }) };
    const deps = {
      sessions: sessionsWith([
        claim('s1', 'lib/x.ts', { agentId: 'agent-1' }),
        claim('s2', 'lib/x.ts', { agentId: 'agent-2' }),
      ]),
      suggestions,
      inbox,
      activityLog,
    };
    runOverlapScan(deps);
    runOverlapScan(deps);
    expect(events.filter((e) => e.type === 'suggestion.surfaced')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'suggestion.suppressed')).toHaveLength(2);
  });

  test('no overlaps → no suggestions, no delivery', () => {
    const res = runOverlapScan({
      sessions: sessionsWith([claim('s1', 'lib/x.ts'), claim('s2', 'lib/y.ts')]),
      suggestions,
      inbox,
    });
    expect(res).toMatchObject({ overlaps: 0, surfaced: 0, delivered: 0 });
    expect(sent).toHaveLength(0);
  });

  test('scan sweeps stale, never-acted nudges to expired (gives expireStale a real caller)', () => {
    let clock = 1000;
    const db2 = createTestDb();
    try {
      const s2 = createSuggestions(db2, { now: () => clock });
      // surface a nudge, then let it age out unacted
      s2.create({ agentId: 'agent-1', kind: 'claim-overlap-headsup', payload: {}, payloadHash: 'old' });
      clock += 8 * 24 * 60 * 60 * 1000; // 8 days > 7-day default stale window
      const res = runOverlapScan({ sessions: sessionsWith([]), suggestions: s2, inbox });
      expect(res.overlaps).toBe(0);
      expect(s2.list({ status: 'expired' })).toHaveLength(1);
    } finally {
      db2.close();
    }
  });
});

describe('runClaimTreeTroubleScan', () => {
  let db;
  let suggestions;
  let sent;
  let inbox;

  beforeEach(() => {
    db = createTestDb();
    suggestions = createSuggestions(db, { now: () => 1000 });
    sent = [];
    inbox = { send(agentId, content, options) { sent.push({ agentId, content, options }); return { success: true }; } };
  });
  afterEach(() => db.close());

  test('delivers one COORDINATE state and Mermaid ego graph to each live claimant', () => {
    const claims = [
      { ...claim('s1', 'lib/x.ts', { agentId: 'agent-1' }), repoId: 'port-daddy', worldKind: 'worktree', worldId: 'wt-a' },
      { ...claim('s2', 'lib/x.ts', { agentId: 'agent-2' }), repoId: 'port-daddy', worldKind: 'worktree', worldId: 'wt-a' },
    ];
    const result = runClaimTreeTroubleScan({ sessions: { listAllActiveClaims: () => ({ success: true, claims, count: 2 }) }, suggestions, inbox });
    expect(result).toMatchObject({ pairs: 1, surfaced: 2, delivered: 2 });
    expect(sent.map(item => item.content.state)).toEqual(['COORDINATE', 'COORDINATE']);
    expect(sent[0].content.mermaid).toContain('flowchart LR');
    expect(sent[0].content.mermaid).toContain('COORDINATE');
  });

  test('does not notify when precise claims share a file but do not collide', () => {
    const claims = [
      { ...claim('s1', 'lib/x.ts', { agentId: 'agent-1', symbolPath: 'A.one' }), repoId: 'port-daddy', worldKind: 'worktree', worldId: 'wt-a' },
      { ...claim('s2', 'lib/x.ts', { agentId: 'agent-2', symbolPath: 'A.two' }), repoId: 'port-daddy', worldKind: 'worktree', worldId: 'wt-a' },
    ];
    const result = runClaimTreeTroubleScan({ sessions: { listAllActiveClaims: () => ({ success: true, claims, count: 2 }) }, suggestions, inbox });
    expect(result).toMatchObject({ pairs: 1, surfaced: 0, delivered: 0 });
  });
});
