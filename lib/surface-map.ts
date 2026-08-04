/**
 * Surface Map — Diff → Touched Regions
 *
 * The bridge from "what an agent actually edited" (a git diff) to "which code
 * symbols/regions that touched" (claims of `session_files` region shape:
 * file_path + start_line/end_line + symbol/symbol_path).
 *
 * This is the core primitive for REGION-LEVEL (not whole-file) coordination:
 * two agents editing disjoint methods of the same class should not collide,
 * but the only way to know that is to map each changed hunk back onto the
 * file's AST symbols. `lib/symbol-index.ts` already produces those symbols via
 * tree-sitter; this module is the pure mapping layer that consumes them.
 *
 * Design:
 * - PURE. No DB, no I/O, no tree-sitter. Callers supply the parsed `Symbol[]`
 *   (from `createSymbolIndex(db).getSymbols(file)`) and the changed hunks.
 * - "Innermost containing symbol" rule: a hunk lands on the SMALLEST-range
 *   symbol whose [startLine, endLine] fully contains it. This makes a method
 *   edit claim the method, not its enclosing class.
 * - A hunk spanning multiple sibling symbols yields one TouchedRegion per
 *   overlapped symbol (each agent's claim surface is the union).
 * - A hunk matching no symbol (imports, top-level statements, blank gaps)
 *   yields a whole-file-fallback region with null symbol fields.
 */

import type { Symbol } from './symbol-index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * A region of a file that a diff touched, resolved to its innermost symbol.
 * Shaped to map cleanly onto a `session_files` region claim:
 *   { file_path, start_line, end_line, symbol_path }.
 */
export interface TouchedRegion {
  filePath: string;
  /** e.g. "ClassName.method"; null if the hunk matches no symbol (imports/top-level). */
  symbolPath: string | null;
  /** From symbol-index `Symbol.symbolType` (function/class/method/...); null when unmatched. */
  symbolKind: string | null;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

/** A contiguous run of changed lines in one file, as reported by `git diff -U0`. */
export interface DiffHunk {
  filePath: string;
  /** 1-based, inclusive. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
}

// =============================================================================
// Core: hunks → touched regions
// =============================================================================

/**
 * Map each changed hunk to the innermost symbol(s) it overlaps.
 *
 * Rules:
 * - Overlap = ranges intersect (hunk and symbol share at least one line).
 * - For a given hunk, consider every symbol it overlaps. Drop any overlapped
 *   symbol that strictly contains another overlapped symbol — "innermost wins"
 *   so a hunk inside a method does not also claim the enclosing class.
 *   (A hunk that genuinely spans two sibling methods still yields both.)
 * - A hunk overlapping NO symbol yields one fallback region with null symbol
 *   fields spanning the hunk's own lines.
 *
 * Output regions are deduplicated by (filePath, symbolPath) — if several hunks
 * land on the same symbol, that symbol's region appears once. The emitted
 * start/end lines for a matched region are the SYMBOL's lines (the claim
 * surface), not the hunk's. Fallback (null) regions keep the hunk's lines and
 * are not deduplicated across distinct line ranges.
 *
 * Pure: no side effects.
 */
export function computeTouchedRegions(
  hunks: DiffHunk[],
  symbolsByFile: Map<string, Symbol[]>,
): TouchedRegion[] {
  const regions: TouchedRegion[] = [];
  // Dedup matched symbols by file+symbolPath; fallbacks by file+lines.
  const seenSymbol = new Set<string>();
  const seenFallback = new Set<string>();

  for (const hunk of hunks) {
    const symbols = symbolsByFile.get(hunk.filePath) ?? [];
    const overlapped = symbols.filter(sym => rangesOverlap(hunk, sym));

    if (overlapped.length === 0) {
      // Whole-file fallback: no symbol contains/overlaps this hunk.
      const key = `${hunk.filePath}:${hunk.startLine}:${hunk.endLine}`;
      if (!seenFallback.has(key)) {
        seenFallback.add(key);
        regions.push({
          filePath: hunk.filePath,
          symbolPath: null,
          symbolKind: null,
          startLine: hunk.startLine,
          endLine: hunk.endLine,
        });
      }
      continue;
    }

    // Keep only the innermost overlapped symbols: drop any symbol that
    // strictly contains another overlapped symbol (it's an ancestor surface).
    const innermost = overlapped.filter(
      sym => !overlapped.some(other => other !== sym && strictlyContains(sym, other)),
    );

    for (const sym of innermost) {
      const key = `${sym.filePath}:${sym.symbolPath}`;
      if (seenSymbol.has(key)) continue;
      seenSymbol.add(key);
      regions.push({
        filePath: sym.filePath,
        symbolPath: sym.symbolPath,
        symbolKind: sym.symbolType,
        startLine: sym.startLine,
        endLine: sym.endLine,
      });
    }
  }

  return regions;
}

/** Two inclusive [start,end] line ranges intersect. Exported so the claim guard
 *  (`lib/claim-guard.ts`) reuses the exact overlap semantics instead of duplicating. */
export function rangesOverlap(
  a: { startLine: number; endLine: number },
  b: { startLine: number; endLine: number },
): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/**
 * `outer` strictly contains `inner`: outer's range fully covers inner's AND
 * they are not the identical range (so two coincident symbols don't eat each
 * other — both survive as innermost).
 */
function strictlyContains(
  outer: { startLine: number; endLine: number },
  inner: { startLine: number; endLine: number },
): boolean {
  const covers = outer.startLine <= inner.startLine && outer.endLine >= inner.endLine;
  const identical = outer.startLine === inner.startLine && outer.endLine === inner.endLine;
  return covers && !identical;
}

// =============================================================================
// Unified-diff hunk parser (`git diff -U0`)
// =============================================================================

/**
 * Parse `git diff` (ideally `-U0`) output into per-file changed hunks.
 *
 * Reads the new-file path from `+++ b/<path>` headers and the changed line
 * range from each `@@ -old +new @@` hunk header. The `+new` side is used
 * because touched regions are about the post-edit file (where the symbols the
 * caller passes live).
 *
 * Hunk header grammar: `@@ -l,s +l,s @@` where `,s` is optional (defaults to 1).
 * A `+l,0` hunk is a pure deletion: it has no lines in the new file, so we
 * attribute it to the line it deletes *at* (the line before the gap, clamped to
 * >= 1) as a single-line hunk, so deletions still map onto a region.
 *
 * Pure: parses text, no I/O.
 */
export function parseUnifiedDiffHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  if (!diffText) return hunks;

  let currentFile: string | null = null;
  const lines = diffText.split('\n');

  for (const line of lines) {
    // New-file path header. Prefer `+++ b/path`; `/dev/null` = deleted file.
    if (line.startsWith('+++ ')) {
      currentFile = parseFilePath(line.slice(4));
      continue;
    }
    // A `diff --git` line resets state in case a file has no +++ (rare, e.g.
    // pure mode change) — don't leak the previous file's path into it.
    if (line.startsWith('diff --git ')) {
      currentFile = null;
      continue;
    }

    if (line.startsWith('@@')) {
      const range = parseHunkHeader(line);
      if (!range || !currentFile) continue;
      hunks.push({
        filePath: currentFile,
        startLine: range.startLine,
        endLine: range.endLine,
      });
    }
  }

  return hunks;
}

/**
 * Strip a diff path token of its `a/` or `b/` prefix and surrounding noise.
 * `+++ b/lib/foo.ts\t` → `lib/foo.ts`. `/dev/null` is returned as-is so callers
 * can recognise a deleted file.
 */
function parseFilePath(raw: string): string | null {
  // Drop a trailing tab + timestamp (git emits these in some configs).
  let p = raw.split('\t')[0].trim();
  if (!p) return null;
  if (p === '/dev/null') return p;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

/**
 * Parse a `@@ -oldStart,oldLen +newStart,newLen @@` header into the inclusive
 * 1-based [startLine, endLine] of the changed region on the NEW side.
 */
function parseHunkHeader(line: string): { startLine: number; endLine: number } | null {
  // Capture the `+newStart[,newLen]` group.
  const match = line.match(/@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!match) return null;

  const newStart = parseInt(match[1], 10);
  const newLen = match[2] !== undefined ? parseInt(match[2], 10) : 1;

  if (newLen === 0) {
    // Pure deletion: no new-file lines. `+newStart` is the line AFTER which the
    // deletion occurred. Attribute to that anchor line (>= 1) as 1 line so the
    // deletion still resolves onto a containing symbol.
    const anchor = Math.max(1, newStart);
    return { startLine: anchor, endLine: anchor };
  }

  return { startLine: newStart, endLine: newStart + newLen - 1 };
}
