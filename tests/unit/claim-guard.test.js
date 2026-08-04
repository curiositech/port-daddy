/**
 * Claim guard (lib/claim-guard.ts) — real edits vs DECLARED symbol claims.
 *
 * Tier 1 (symbol-identity) routes through the injected predictConflicts (the
 * existing engine, faked here with the real direct-conflict semantics); tier 2
 * (span-overlap) checks raw line-range intersection against the claimed symbol's
 * indexed span, catching null-symbolPath regions and symbolPath drift.
 */

import { detectEditsAgainstClaims } from '../../lib/claim-guard.js';

/** Faked symbol index: real spans for one file, identity-only predictConflicts
 *  implementing modify×modify=direct/blocking, read×anything=safe (subset of the
 *  real matrix that these cases exercise). */
function makeSymbolIndex({ symbols = {}, onParse } = {}) {
  return {
    parsed: [],
    async parseFile(p) {
      this.parsed.push(p);
      if (onParse) onParse(p);
    },
    getSymbols(p) {
      const key = Object.keys(symbols).find((k) => p === k || p.endsWith(`/${k}`));
      return key ? symbols[key] : [];
    },
    predictConflicts(a, b) {
      const out = [];
      for (const ca of a) {
        for (const cb of b) {
          if (ca.filePath === cb.filePath && ca.symbolPath === cb.symbolPath) {
            if (ca.type === 'read' || cb.type === 'read') continue; // safe pair
            out.push({ type: 'direct', severity: 'blocking', confidence: 1.0, a: ca, b: cb });
          }
        }
      }
      return out;
    },
  };
}

const FOO_SPAN = { symbolPath: 'foo', symbolType: 'function', startLine: 10, endLine: 20 };
const BAR_SPAN = { symbolPath: 'bar', symbolType: 'function', startLine: 30, endLine: 40 };

describe('detectEditsAgainstClaims', () => {
  test('edit inside claimed foo() (same symbol identity) → blocking symbol-identity hit', async () => {
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: '/wt/lib/a.ts', symbolPath: 'foo', symbolKind: 'function', startLine: 10, endLine: 20 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      claimedBy: 'holder-session',
      via: 'symbol-identity',
      conflict: { type: 'direct', severity: 'blocking' },
    });
    expect(hits[0].conflict.b.symbolPath).toBe('foo');
  });

  test('null-symbolPath hunk overlapping the claimed span → span-overlap blocking hit', async () => {
    // Editor's hunk resolved to no symbol (import/top-level or unparseable state),
    // but its raw lines land inside foo's indexed span.
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: 'lib/a.ts', symbolPath: null, symbolKind: null, startLine: 12, endLine: 14 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ claimedBy: 'holder-session', via: 'span-overlap' });
    expect(hits[0].conflict.severity).toBe('blocking');
    expect(hits[0].conflict.b.symbolPath).toBe('foo');
    // the edit side names its raw lines since no symbol resolved
    expect(hits[0].conflict.a.symbolPath).toContain('12-14');
  });

  test('symbolPath drift: region resolved to a DIFFERENT name still trips the span wire', async () => {
    // The claim says "foo" but the editor's re-parse yielded "Renamed.foo" over the
    // same lines — identity misses, raw spans catch it.
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: '/wt/lib/a.ts', symbolPath: 'Renamed.foo', symbolKind: 'method', startLine: 10, endLine: 20 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);
    expect(hits).toHaveLength(1);
    expect(hits[0].via).toBe('span-overlap');
  });

  test('disjoint edit → no hits', async () => {
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN, BAR_SPAN] } });
    const regions = [
      { filePath: '/wt/lib/a.ts', symbolPath: 'bar', symbolKind: 'function', startLine: 30, endLine: 40 },
      { filePath: '/wt/lib/a.ts', symbolPath: null, symbolKind: null, startLine: 50, endLine: 55 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);
    expect(hits).toHaveLength(0);
  });

  test('the editor session\'s OWN declared claims are ignored', async () => {
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: '/wt/lib/a.ts', symbolPath: 'foo', symbolKind: 'function', startLine: 10, endLine: 20 },
    ];
    const declared = new Map([
      ['editor-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);
    expect(hits).toHaveLength(0);
  });

  test('an identity pair the matrix calls SAFE is not re-flagged by the span tier', async () => {
    // Editor edits foo; holder holds a read-claim on foo. The (faked) matrix says
    // safe → no identity hit, and tier 2 must NOT resurrect it as blocking just
    // because the spans coincide.
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: '/wt/lib/a.ts', symbolPath: 'foo', symbolKind: 'function', startLine: 10, endLine: 20 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'read' }]],
    ]);

    const hits = await detectEditsAgainstClaims('editor-session', regions, declared, idx);
    expect(hits).toHaveLength(0);
  });

  test('claimed files are re-parsed for span freshness (once per distinct file)', async () => {
    const idx = makeSymbolIndex({ symbols: { 'lib/a.ts': [FOO_SPAN] } });
    const regions = [
      { filePath: 'lib/a.ts', symbolPath: null, symbolKind: null, startLine: 12, endLine: 12 },
    ];
    const declared = new Map([
      ['h1', [
        { filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' },
        { filePath: '/wt/lib/a.ts', symbolPath: 'bar', type: 'read' },
      ]],
      ['h2', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    await detectEditsAgainstClaims('editor-session', regions, declared, idx);
    expect(idx.parsed).toEqual(['/wt/lib/a.ts']); // deduped across claims and holders
  });

  test('a parseFile failure on the claimed file is fail-soft (no throw, span tier skips)', async () => {
    const idx = makeSymbolIndex({
      symbols: {},
      onParse: () => { throw new Error('unparseable'); },
    });
    const regions = [
      { filePath: 'lib/a.ts', symbolPath: null, symbolKind: null, startLine: 12, endLine: 12 },
    ];
    const declared = new Map([
      ['holder-session', [{ filePath: '/wt/lib/a.ts', symbolPath: 'foo', type: 'modify' }]],
    ]);

    await expect(
      detectEditsAgainstClaims('editor-session', regions, declared, idx),
    ).resolves.toEqual([]);
  });
});
