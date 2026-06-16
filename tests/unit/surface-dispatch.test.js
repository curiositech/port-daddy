import {
  preflightDispatch,
  runPreflight,
} from '../../lib/surface-dispatch.js';

/** Build an ActiveClaimLite with sane defaults (whole-file unless a range is given). */
function held(sessionId, filePath, opts = {}) {
  return {
    filePath,
    sessionId,
    agentId: opts.agentId ?? null,
    symbolPath: opts.symbolPath ?? null,
    startLine: opts.startLine ?? null,
    endLine: opts.endLine ?? null,
  };
}

/** Build a DispatchSurface (whole-file unless a range/symbol is given). */
function surface(filePath, opts = {}) {
  return {
    filePath,
    symbolPath: opts.symbolPath ?? null,
    startLine: opts.startLine ?? null,
    endLine: opts.endLine ?? null,
  };
}

describe('preflightDispatch — verdicts', () => {
  test('clear when intended surfaces are disjoint from held claims (different files)', () => {
    const intended = [surface('a.ts', { startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'b.ts', { startLine: 1, endLine: 10 })];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('clear');
    expect(report.conflicts).toHaveLength(0);
    expect(report.checkedSurfaces).toBe(1);
  });

  test('clear when same file but ranges do not intersect', () => {
    const intended = [surface('a.ts', { startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts', { startLine: 50, endLine: 60 })];
    expect(preflightDispatch(intended, claims, 's1').verdict).toBe('clear');
  });

  test('refuse on same symbolPath held by a distinct session', () => {
    const intended = [surface('a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10, agentId: 'agent-2' })];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('refuse');
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].reason).toBe('same-symbol');
    expect(report.conflicts[0].heldBy.sessionId).toBe('s2');
    expect(report.conflicts[0].heldBy.agentId).toBe('agent-2');
  });

  test('clear when symbolPaths differ on the same file (distinct symbols do not collide)', () => {
    const intended = [surface('a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts', { symbolPath: 'Foo.baz', startLine: 1, endLine: 10 })];
    expect(preflightDispatch(intended, claims, 's1').verdict).toBe('clear');
  });

  test('warn when only line ranges overlap (no symbol/whole-file collision)', () => {
    const intended = [surface('a.ts', { startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts', { startLine: 5, endLine: 15 })];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('warn');
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0].reason).toBe('range-overlap');
  });

  test('whole-file held claim conflicts everything → refuse', () => {
    const intended = [surface('a.ts', { startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts')]; // null range = whole-file
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('refuse');
    expect(report.conflicts[0].reason).toBe('whole-file');
  });

  test('whole-file intended surface conflicts a held ranged claim → refuse', () => {
    const intended = [surface('a.ts')]; // null range = whole-file intent
    const claims = [held('s2', 'a.ts', { startLine: 5, endLine: 15 })];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('refuse');
    expect(report.conflicts[0].reason).toBe('whole-file');
  });

  test('self-session claims never conflict (excluded by selfSessionId)', () => {
    const intended = [surface('a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 })];
    const claims = [held('s1', 'a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 })];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('clear');
    expect(report.conflicts).toHaveLength(0);
  });

  test('empty intended surfaces → clear with checkedSurfaces 0', () => {
    const claims = [held('s2', 'a.ts')];
    const report = preflightDispatch([], claims, 's1');
    expect(report.verdict).toBe('clear');
    expect(report.conflicts).toHaveLength(0);
    expect(report.checkedSurfaces).toBe(0);
  });

  test('refuse dominates warn when both a hard and soft conflict are present', () => {
    const intended = [
      surface('a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 }),
      surface('b.ts', { startLine: 1, endLine: 10 }),
    ];
    const claims = [
      held('s2', 'a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 }), // refuse
      held('s3', 'b.ts', { startLine: 5, endLine: 15 }), // warn-grade
    ];
    const report = preflightDispatch(intended, claims, 's1');
    expect(report.verdict).toBe('refuse');
    expect(report.conflicts).toHaveLength(2);
  });

  test('no selfSessionId still works (every claim is "other")', () => {
    const intended = [surface('a.ts', { startLine: 1, endLine: 10 })];
    const claims = [held('s2', 'a.ts', { startLine: 5, endLine: 15 })];
    expect(preflightDispatch(intended, claims).verdict).toBe('warn');
  });
});

describe('runPreflight — deps-injected orchestrator', () => {
  test('reads sessions.listAllActiveClaims and delegates to the pure core', () => {
    const sessions = {
      listAllActiveClaims: () => ({
        success: true,
        claims: [
          {
            filePath: 'a.ts',
            sessionId: 's2',
            agentId: 'agent-2',
            symbolPath: 'Foo.bar',
            startLine: 1,
            endLine: 10,
          },
        ],
      }),
    };
    const report = runPreflight(
      { sessions },
      [surface('a.ts', { symbolPath: 'Foo.bar', startLine: 1, endLine: 10 })],
      's1',
    );
    expect(report.verdict).toBe('refuse');
    expect(report.conflicts[0].heldBy.sessionId).toBe('s2');
  });

  test('treats a failed claim read as no held claims → clear', () => {
    const sessions = { listAllActiveClaims: () => ({ success: false, claims: [] }) };
    const report = runPreflight({ sessions }, [surface('a.ts')], 's1');
    expect(report.verdict).toBe('clear');
  });
});
