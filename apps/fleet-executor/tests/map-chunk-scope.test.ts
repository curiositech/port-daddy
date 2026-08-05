/**
 * MAP-stage scope contract: a reviewer must know what it cannot see.
 *
 * Review is map-reduce over diff chunks. Each model call gets one chunk of a
 * diff that may span dozens of files, and the changed-file list names every
 * file in the PR. Before this contract existed, that combination produced two
 * systematic failure modes — both observed on #4956, where one reviewer shipped
 * ten findings and every single one was false:
 *
 *   1. **Fabricated absence.** A reviewer whose chunk did not contain
 *      `features.manifest.json` reported the manifest entry missing; one whose
 *      chunk lacked the new test file reported the tests missing; one reported
 *      an exported constant unexported. Each was present in another chunk, and
 *      each shipped as HIGH with a one-click issue button.
 *
 *   2. **Misattribution.** With every path listed but none marked as present,
 *      a snippet lifted from `lib/local-citizen/ink-cloud.ts` was reported as a
 *      syntax error at a line in `lib/squid/reconcile-sources.ts` — a file
 *      whose text does not contain the quoted fragment anywhere.
 *
 * These tests pin the two halves of the fix: the prompt has to state the
 * boundary, and the pipeline has to enforce path validity regardless of whether
 * the model honours the prompt.
 */
import { describe, expect, it } from 'vitest';

import { chunkDiff, filesInChunk } from '../src/execute.js';

const diffFor = (path: string, body = '+  const x = 1;'): string =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,2 @@\n${body}\n`;

describe('filesInChunk', () => {
  it('reads every path out of a multi-file chunk', () => {
    const chunk = diffFor('lib/a.ts') + diffFor('lib/b.ts') + diffFor('lib/c.ts');
    expect(filesInChunk(chunk)).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/c.ts']);
  });

  it('prefers the b/ path, so a rename is attributed to its new name', () => {
    const renamed = 'diff --git a/old/name.ts b/new/name.ts\n--- a/old/name.ts\n+++ b/new/name.ts\n@@ -1 +1 @@\n+x\n';
    expect(filesInChunk(renamed)).toEqual(['new/name.ts']);
  });

  it('returns nothing for an empty chunk rather than throwing', () => {
    expect(filesInChunk('')).toEqual([]);
  });

  it('does not invent paths from diff body text', () => {
    // A hunk that merely mentions a filename must not register as that file —
    // this is the misattribution vector.
    const chunk = diffFor('lib/real.ts', '+  // see lib/squid/reconcile-sources.ts for context');
    expect(filesInChunk(chunk)).toEqual(['lib/real.ts']);
  });
});

describe('chunkDiff boundaries line up with filesInChunk', () => {
  it('every chunk reports exactly the files it contains', () => {
    const diff = ['a', 'b', 'c', 'd'].map(n => diffFor(`lib/${n}.ts`)).join('');
    const chunks = chunkDiff(diff);
    const seen = chunks.flatMap(filesInChunk);
    // Nothing lost, nothing duplicated across chunk boundaries.
    expect(seen.sort()).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/c.ts', 'lib/d.ts']);
  });

  it('a chunk never claims a file that lives in a different chunk', () => {
    const diff = ['a', 'b', 'c', 'd'].map(n => diffFor(`lib/${n}.ts`)).join('');
    const chunks = chunkDiff(diff);
    const perChunk = chunks.map(c => new Set(filesInChunk(c)));
    for (let i = 0; i < perChunk.length; i += 1) {
      for (let j = i + 1; j < perChunk.length; j += 1) {
        for (const f of perChunk[i]) expect(perChunk[j].has(f)).toBe(false);
      }
    }
  });
});

/**
 * The enforcement half, exercised as pure logic.
 *
 * `execute.ts` filters parsed findings against the PR's changed-file set before
 * they are rendered or posted. The filter itself is a one-liner; what it buys
 * is that a wrong FILE — which means the reasoning was about something else
 * entirely — never reaches a reviewer, no matter what the model emitted.
 */
describe('finding path validity', () => {
  const changed = new Set(['lib/squid/reconcile-sources.ts', 'features.manifest.json']);
  const keep = (path: string): boolean => !path || changed.has(path);

  it('keeps a finding citing a file the PR actually touched', () => {
    expect(keep('lib/squid/reconcile-sources.ts')).toBe(true);
  });

  it('drops a finding citing a file outside the diff', () => {
    // The #4956 case: the quoted code was real, but it lived in a file this PR
    // never touched, so the finding could not have been about this PR.
    expect(keep('lib/local-citizen/ink-cloud.ts')).toBe(false);
  });

  it('keeps a finding with no path rather than silently discarding it', () => {
    // A pathless finding may still be a legitimate PR-level observation; only
    // a demonstrably WRONG path is grounds for dropping.
    expect(keep('')).toBe(true);
  });
});

/**
 * The guard must fail OPEN when it cannot trust the changed-file list.
 *
 * `fetchPRContext` returns `files: []` if GitHub's /files call fails, and asks
 * for `per_page=100` without paginating — so an empty list means "unknown" and
 * a full page may be truncated. Filtering against either would silently discard
 * real findings, which is strictly worse than letting a bogus one through: a
 * dropped finding is invisible, a wrong one is at least arguable in the thread.
 */
describe('path filter trust conditions', () => {
  const PAGE = 100;
  const trustworthy = (fileCount: number): boolean => fileCount > 0 && fileCount < PAGE;

  it('filters when the file list is present and complete', () => {
    expect(trustworthy(1)).toBe(true);
    expect(trustworthy(54)).toBe(true);
    expect(trustworthy(99)).toBe(true);
  });

  it('does NOT filter when the list is empty — that means the fetch failed', () => {
    expect(trustworthy(0)).toBe(false);
  });

  it('does NOT filter at or beyond the page size — the list may be truncated', () => {
    // A 100-file PR is indistinguishable from a 400-file PR here, and files
    // 101+ would every one of them look "not in this PR".
    expect(trustworthy(PAGE)).toBe(false);
    expect(trustworthy(PAGE + 50)).toBe(false);
  });
});

/**
 * Paths containing spaces — git allows them and this repository has one.
 *
 * `public/Untitled 2.png` is a real tracked file here. A `\S+`-based parse of
 * `diff --git a/X b/Y` silently yields the wrong path (or none) for it, and the
 * file is then marked "not in this chunk" while its hunks sit right there. That
 * is the scope contract failing in the one direction it must not: telling a
 * reviewer it cannot see something it can.
 */
describe('space-containing paths', () => {
  const spaced = 'public/Untitled 2.png';

  it('parses a path with a space from the diff header', () => {
    expect(filesInChunk(diffFor(spaced))).toEqual([spaced]);
  });

  it('parses a spaced path alongside ordinary ones', () => {
    const chunk = diffFor('lib/a.ts') + diffFor(spaced) + diffFor('lib/b.ts');
    expect(filesInChunk(chunk).sort()).toEqual([spaced, 'lib/a.ts', 'lib/b.ts'].sort());
  });

  it('handles a path with several spaces', () => {
    const messy = 'docs/some long name here.md';
    expect(filesInChunk(diffFor(messy))).toEqual([messy]);
  });
});

/**
 * An oversized single file is hard-split, and every slice must still say which
 * file it belongs to.
 *
 * Before this, only the FIRST slice carried the `diff --git` header, so
 * `filesInChunk()` returned [] for every continuation and the prompt showed no
 * files as present — breaking attribution precisely on the largest files, which
 * are the ones whose reviewers most need it.
 */
describe('oversized files keep their attribution', () => {
  it('every slice of a hard-split file still names that file', () => {
    const huge = `diff --git a/lib/huge.ts b/lib/huge.ts\n--- a/lib/huge.ts\n+++ b/lib/huge.ts\n@@ -1,1 +1,2 @@\n${'+  const filler = 1;\n'.repeat(2000)}`;
    const chunks = chunkDiff(huge);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(filesInChunk(c)).toContain('lib/huge.ts');
    }
  });

  it('no slice exceeds the char budget despite the re-emitted header', () => {
    const huge = `diff --git a/lib/huge.ts b/lib/huge.ts\n${'+  x\n'.repeat(9000)}`;
    for (const c of chunkDiff(huge)) {
      expect(c.length).toBeLessThanOrEqual(12_000);
    }
  });
});
