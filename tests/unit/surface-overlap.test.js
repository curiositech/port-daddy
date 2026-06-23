import {
  detectSymbolOverlaps,
  symbolOverlapKey,
} from '../../lib/surface-overlap.js';

/** Build a TouchedRegion with sensible defaults. */
function region(filePath, opts = {}) {
  return {
    filePath,
    symbolPath: opts.symbolPath ?? null,
    symbolKind: opts.symbolKind ?? null,
    startLine: opts.startLine ?? 1,
    endLine: opts.endLine ?? 10,
  };
}

/** Build a SessionSurface. */
function surface(sessionId, regions, opts = {}) {
  return {
    sessionId,
    agentId: opts.agentId ?? null,
    purpose: opts.purpose ?? `purpose-${sessionId}`,
    regions,
  };
}

describe('detectSymbolOverlaps — symbol matching', () => {
  test('two sessions touching the same symbol overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar', symbolKind: 'method' })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.bar', symbolKind: 'method' })]),
    ];
    const overlaps = detectSymbolOverlaps(surfaces);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].symbolPath).toBe('Foo.bar');
    expect(overlaps[0].filePath).toBe('lib/a.ts');
    // `a` is the lexicographically smaller session.
    expect(overlaps[0].a.sessionId).toBe('alpha');
    expect(overlaps[0].b.sessionId).toBe('bravo');
  });

  test('same file, different symbols → no overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.baz' })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(0);
  });

  test('same symbol path but different files → no overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
      surface('bravo', [region('lib/b.ts', { symbolPath: 'Foo.bar' })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(0);
  });
});

describe('detectSymbolOverlaps — line-range fallback (null symbolPath)', () => {
  test('null symbolPath on one side with intersecting ranges → overlap (whole-file/range)', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: null, startLine: 1, endLine: 20 })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.bar', startLine: 10, endLine: 15 })]),
    ];
    const overlaps = detectSymbolOverlaps(surfaces);
    expect(overlaps).toHaveLength(1);
    // Contested symbolPath is null because one side lacked a symbol → matched on range.
    expect(overlaps[0].symbolPath).toBeNull();
  });

  test('both null symbolPath, intersecting ranges → overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: null, startLine: 1, endLine: 10 })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: null, startLine: 8, endLine: 12 })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(1);
  });

  test('null symbolPath but disjoint ranges → no overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: null, startLine: 1, endLine: 5 })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: null, startLine: 6, endLine: 10 })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(0);
  });

  test('touching ranges (shared boundary line) → overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: null, startLine: 1, endLine: 6 })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: null, startLine: 6, endLine: 10 })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(1);
  });
});

describe('detectSymbolOverlaps — invariants', () => {
  test('a session never overlaps itself (multiple regions, same session)', () => {
    const surfaces = [
      surface('alpha', [
        region('lib/a.ts', { symbolPath: 'Foo.bar' }),
        region('lib/a.ts', { symbolPath: 'Foo.bar' }),
      ]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(0);
  });

  test('duplicate sessionId entries do not self-overlap', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(0);
  });

  test('result is order-independent (input shuffle yields same overlap)', () => {
    const a = surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]);
    const b = surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]);
    const o1 = detectSymbolOverlaps([a, b]);
    const o2 = detectSymbolOverlaps([b, a]);
    expect(o1).toHaveLength(1);
    expect(o2).toHaveLength(1);
    // `a` always the smaller session regardless of input order.
    expect(o1[0].a.sessionId).toBe('alpha');
    expect(o2[0].a.sessionId).toBe('alpha');
    expect(symbolOverlapKey(o1[0])).toBe(symbolOverlapKey(o2[0]));
  });

  test('three sessions on one symbol → three unordered pairs', () => {
    const surfaces = [
      surface('alpha', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
      surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
      surface('charlie', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
    ];
    const overlaps = detectSymbolOverlaps(surfaces);
    expect(overlaps).toHaveLength(3);
    const keys = new Set(overlaps.map(symbolOverlapKey));
    expect(keys.size).toBe(3);
  });

  test('duplicate region pairs hitting the same symbol collapse to one overlap', () => {
    const surfaces = [
      surface('alpha', [
        region('lib/a.ts', { symbolPath: 'Foo.bar' }),
        region('lib/a.ts', { symbolPath: 'Foo.bar' }),
      ]),
      surface('bravo', [region('lib/a.ts', { symbolPath: 'Foo.bar' })]),
    ];
    expect(detectSymbolOverlaps(surfaces)).toHaveLength(1);
  });
});

describe('symbolOverlapKey — stability', () => {
  test('stable dedup key regardless of session order', () => {
    const base = {
      filePath: 'lib/a.ts',
      symbolPath: 'Foo.bar',
      a: { sessionId: 'alpha', agentId: null, region: region('lib/a.ts', { symbolPath: 'Foo.bar' }) },
      b: { sessionId: 'bravo', agentId: null, region: region('lib/a.ts', { symbolPath: 'Foo.bar' }) },
    };
    const swapped = {
      ...base,
      a: base.b,
      b: base.a,
    };
    expect(symbolOverlapKey(base)).toBe(symbolOverlapKey(swapped));
  });

  test('null contested symbol renders as "*" in the key', () => {
    const o = {
      filePath: 'lib/a.ts',
      symbolPath: null,
      a: { sessionId: 'alpha', agentId: null, region: region('lib/a.ts') },
      b: { sessionId: 'bravo', agentId: null, region: region('lib/a.ts') },
    };
    expect(symbolOverlapKey(o)).toBe('symbol-overlap:lib/a.ts:alpha|bravo:*');
  });

  test('different symbols on same pair yield different keys', () => {
    const mk = (sym) => ({
      filePath: 'lib/a.ts',
      symbolPath: sym,
      a: { sessionId: 'alpha', agentId: null, region: region('lib/a.ts') },
      b: { sessionId: 'bravo', agentId: null, region: region('lib/a.ts') },
    });
    expect(symbolOverlapKey(mk('Foo.bar'))).not.toBe(symbolOverlapKey(mk('Foo.baz')));
  });
});
