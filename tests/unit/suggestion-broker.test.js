import { createTestDb } from '../setup-unit.js';
import { createSuggestions } from '../../lib/suggestions.js';
import {
  detectClaimOverlaps,
  rangesOverlap,
  overlapPayloadHash,
  runOverlapScan,
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
});
