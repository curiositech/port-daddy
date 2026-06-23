/**
 * Unit Tests for Surface Map (lib/surface-map.ts)
 *
 * Pure module — no DB. Covers:
 *  - hunk inside one symbol
 *  - hunk spanning two sibling symbols
 *  - hunk matching no symbol (null whole-file fallback)
 *  - nested symbols (innermost wins)
 *  - the `git diff -U0` hunk parser on real diff text
 */

import { describe, it, expect } from '@jest/globals';
import {
  computeTouchedRegions,
  parseUnifiedDiffHunks,
} from '../../lib/surface-map.js';

// Minimal Symbol factory satisfying the symbol-index `Symbol` interface.
// computeTouchedRegions only reads filePath/symbolPath/symbolType/start/end,
// but we fill the rest so the test data is a faithful Symbol.
function sym(filePath, symbolPath, symbolType, startLine, endLine, extra = {}) {
  return {
    id: 1,
    filePath,
    symbolName: symbolPath.split('.').pop(),
    symbolType,
    symbolPath,
    startLine,
    endLine,
    parentSymbol: symbolPath.includes('.')
      ? symbolPath.slice(0, symbolPath.lastIndexOf('.'))
      : null,
    signature: null,
    bodyHash: null,
    exported: false,
    parsedAt: 0,
    ...extra,
  };
}

const FILE = '/repo/lib/foo.ts';

describe('computeTouchedRegions', () => {
  it('maps a hunk inside one symbol to that symbol', () => {
    const symbols = new Map([
      [FILE, [sym(FILE, 'doThing', 'function', 10, 30)]],
    ]);
    const hunks = [{ filePath: FILE, startLine: 15, endLine: 18 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toEqual([
      {
        filePath: FILE,
        symbolPath: 'doThing',
        symbolKind: 'function',
        startLine: 10,
        endLine: 30,
      },
    ]);
  });

  it('yields one region per symbol when a hunk spans two siblings', () => {
    const symbols = new Map([
      [
        FILE,
        [
          sym(FILE, 'first', 'function', 10, 20),
          sym(FILE, 'second', 'function', 21, 40),
        ],
      ],
    ]);
    // Hunk straddles the boundary between first and second.
    const hunks = [{ filePath: FILE, startLine: 18, endLine: 25 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toHaveLength(2);
    expect(regions.map(r => r.symbolPath).sort()).toEqual(['first', 'second']);
    // Each region reports the symbol's full range, not the hunk's.
    const first = regions.find(r => r.symbolPath === 'first');
    expect(first).toMatchObject({ startLine: 10, endLine: 20 });
    const second = regions.find(r => r.symbolPath === 'second');
    expect(second).toMatchObject({ startLine: 21, endLine: 40 });
  });

  it('falls back to a null whole-file region when a hunk matches no symbol', () => {
    const symbols = new Map([
      [FILE, [sym(FILE, 'doThing', 'function', 10, 30)]],
    ]);
    // Lines 1-3 are imports — above every symbol.
    const hunks = [{ filePath: FILE, startLine: 1, endLine: 3 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toEqual([
      {
        filePath: FILE,
        symbolPath: null,
        symbolKind: null,
        startLine: 1,
        endLine: 3,
      },
    ]);
  });

  it('falls back to null when the file has no indexed symbols at all', () => {
    const symbols = new Map(); // empty index
    const hunks = [{ filePath: FILE, startLine: 5, endLine: 7 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toEqual([
      {
        filePath: FILE,
        symbolPath: null,
        symbolKind: null,
        startLine: 5,
        endLine: 7,
      },
    ]);
  });

  it('picks the innermost symbol for nested symbols (method, not class)', () => {
    const symbols = new Map([
      [
        FILE,
        [
          sym(FILE, 'Widget', 'class', 5, 60),
          sym(FILE, 'Widget.render', 'method', 20, 35),
        ],
      ],
    ]);
    // Hunk lands inside the method, which is inside the class.
    const hunks = [{ filePath: FILE, startLine: 24, endLine: 26 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toEqual([
      {
        filePath: FILE,
        symbolPath: 'Widget.render',
        symbolKind: 'method',
        startLine: 20,
        endLine: 35,
      },
    ]);
  });

  it('claims the enclosing class when a hunk hits class lines outside any method', () => {
    const symbols = new Map([
      [
        FILE,
        [
          sym(FILE, 'Widget', 'class', 5, 60),
          sym(FILE, 'Widget.render', 'method', 20, 35),
        ],
      ],
    ]);
    // Hunk on a field declaration between the class header and the method.
    const hunks = [{ filePath: FILE, startLine: 8, endLine: 9 }];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toEqual([
      {
        filePath: FILE,
        symbolPath: 'Widget',
        symbolKind: 'class',
        startLine: 5,
        endLine: 60,
      },
    ]);
  });

  it('deduplicates when multiple hunks land on the same symbol', () => {
    const symbols = new Map([
      [FILE, [sym(FILE, 'doThing', 'function', 10, 30)]],
    ]);
    const hunks = [
      { filePath: FILE, startLine: 12, endLine: 13 },
      { filePath: FILE, startLine: 20, endLine: 22 },
    ];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions).toHaveLength(1);
    expect(regions[0].symbolPath).toBe('doThing');
  });

  it('handles hunks across multiple files independently', () => {
    const other = '/repo/lib/bar.ts';
    const symbols = new Map([
      [FILE, [sym(FILE, 'foo', 'function', 1, 10)]],
      [other, [sym(other, 'bar', 'function', 1, 10)]],
    ]);
    const hunks = [
      { filePath: FILE, startLine: 3, endLine: 4 },
      { filePath: other, startLine: 5, endLine: 6 },
    ];

    const regions = computeTouchedRegions(hunks, symbols);

    expect(regions.map(r => r.symbolPath).sort()).toEqual(['bar', 'foo']);
  });
});

describe('parseUnifiedDiffHunks', () => {
  it('parses a real `git diff -U0` with multiple hunks across files', () => {
    const diff = [
      'diff --git a/lib/foo.ts b/lib/foo.ts',
      'index 1111111..2222222 100644',
      '--- a/lib/foo.ts',
      '+++ b/lib/foo.ts',
      '@@ -10,2 +10,3 @@ function doThing() {',
      '-  const a = 1;',
      '-  const b = 2;',
      '+  const a = 1;',
      '+  const b = 2;',
      '+  const c = 3;',
      '@@ -40,0 +41,2 @@ class Widget {',
      '+  newField = true;',
      '+  another = false;',
      'diff --git a/lib/bar.ts b/lib/bar.ts',
      'index 3333333..4444444 100644',
      '--- a/lib/bar.ts',
      '+++ b/lib/bar.ts',
      '@@ -5 +5 @@ export function bar() {',
      '-  return 1;',
      '+  return 2;',
    ].join('\n');

    const hunks = parseUnifiedDiffHunks(diff);

    expect(hunks).toEqual([
      { filePath: 'lib/foo.ts', startLine: 10, endLine: 12 },
      { filePath: 'lib/foo.ts', startLine: 41, endLine: 42 },
      { filePath: 'lib/bar.ts', startLine: 5, endLine: 5 },
    ]);
  });

  it('treats a +n,0 pure-deletion hunk as a single anchor line', () => {
    const diff = [
      'diff --git a/lib/foo.ts b/lib/foo.ts',
      '--- a/lib/foo.ts',
      '+++ b/lib/foo.ts',
      '@@ -20,3 +19,0 @@ function doThing() {',
      '-  const a = 1;',
      '-  const b = 2;',
      '-  const c = 3;',
    ].join('\n');

    const hunks = parseUnifiedDiffHunks(diff);

    expect(hunks).toEqual([
      { filePath: 'lib/foo.ts', startLine: 19, endLine: 19 },
    ]);
  });

  it('defaults an omitted length to 1 line', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -7 +7 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(parseUnifiedDiffHunks(diff)).toEqual([
      { filePath: 'x.ts', startLine: 7, endLine: 7 },
    ]);
  });

  it('returns empty for empty or symbol-less input', () => {
    expect(parseUnifiedDiffHunks('')).toEqual([]);
    expect(parseUnifiedDiffHunks('not a diff\njust text')).toEqual([]);
  });

  it('ignores hunk headers that appear before any file header', () => {
    const diff = '@@ -1 +1 @@\n-x\n+y';
    expect(parseUnifiedDiffHunks(diff)).toEqual([]);
  });

  it('round-trips diff → hunks → touched regions', () => {
    const diff = [
      'diff --git a/lib/foo.ts b/lib/foo.ts',
      '--- a/lib/foo.ts',
      '+++ b/lib/foo.ts',
      '@@ -24,1 +24,2 @@ render() {',
      '-  return null;',
      '+  return <div/>;',
      '+  // note',
    ].join('\n');

    const hunks = parseUnifiedDiffHunks(diff);
    const symbols = new Map([
      [
        'lib/foo.ts',
        [
          sym('lib/foo.ts', 'Widget', 'class', 5, 60),
          sym('lib/foo.ts', 'Widget.render', 'method', 20, 35),
        ],
      ],
    ]);

    const regions = computeTouchedRegions(hunks, symbols);
    expect(regions).toEqual([
      {
        filePath: 'lib/foo.ts',
        symbolPath: 'Widget.render',
        symbolKind: 'method',
        startLine: 20,
        endLine: 35,
      },
    ]);
  });
});
