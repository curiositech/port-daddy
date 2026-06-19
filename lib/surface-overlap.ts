/**
 * Surface overlap — the *symbol-level, edit-derived* half of the suggestibility layer.
 *
 * The existing `lib/suggestion-broker.ts` detector (`detectClaimOverlaps`) only sees a
 * collision when two sessions hold overlapping *declared* claims — i.e. an agent voluntarily
 * ran `pd session files add`. An agent that just edits a file without ever claiming it is
 * invisible to that detector, and the duplicate work / merge collision happens silently.
 * That is the claim-evasion gap.
 *
 * This module closes it from the opposite direction: instead of trusting declarations, it
 * derives each session's *actual* touched surface from its real edits (git diff mapped onto
 * the file's AST symbols — see `lib/symbol-index.ts` for the `Symbol`/`ConflictPrediction`
 * surface and `lib/surface-map.ts`, built in parallel, for the diff→region mapping) and
 * detects when two distinct sessions are touching the same code symbol. No declaration
 * required; the signal comes from the edits themselves.
 *
 * It mirrors `detectClaimOverlaps`'s discipline exactly: unordered session pairs collapse to
 * one overlap with `a` holding the lexicographically smaller `sessionId`, so the dedup key is
 * stable across scans and regardless of input order. It is PURE — no DB, no IO — so the
 * matching logic is unit-tested without a daemon. The IO orchestration that fetches diffs,
 * builds surfaces, and surfaces nudges lives elsewhere (the broker analogue), keeping this
 * file trivially verifiable.
 *
 * `TouchedRegion` is defined here as a minimal local interface (exactly the four fields the
 * sibling `lib/surface-map.ts` produces) so this module can be tested independently; the
 * type unification with surface-map happens at integration time.
 */

/**
 * One contiguous region an agent's diff actually touched, mapped onto the file's symbols.
 * `symbolPath` is the AST path of the enclosing symbol (e.g. `Foo.bar`) when the diff lands
 * inside a known symbol; it is `null` for edits that fall outside any symbol (imports,
 * top-level statements, whitespace) — those are matched by line-range intersection instead.
 */
export interface TouchedRegion {
  filePath: string;
  symbolPath: string | null;
  symbolKind: string | null;
  startLine: number;
  endLine: number;
}

/** The full touched surface of one live session, derived from its real edits. */
export interface SessionSurface {
  sessionId: string;
  agentId: string | null;
  purpose: string;
  regions: TouchedRegion[];
}

/**
 * A detected symbol-level overlap between two distinct sessions on one file. The *pair* is
 * unordered — (A,B) and (B,A) collapse to one `SymbolOverlap` with `a` the lexicographically
 * smaller `sessionId`, so `symbolOverlapKey` is stable across scans.
 */
export interface SymbolOverlap {
  filePath: string;
  /** The contested symbol path, or `null` when the overlap is a whole-file/line-range hit
   *  (either side lacked a `symbolPath` and the regions' line ranges intersected). */
  symbolPath: string | null;
  a: { sessionId: string; agentId: string | null; region: TouchedRegion };
  b: { sessionId: string; agentId: string | null; region: TouchedRegion };
}

/**
 * Whether two inclusive line ranges intersect. Mirrors the range semantics in
 * `lib/suggestion-broker.ts`, but `TouchedRegion` ranges are always concrete (a diff hunk
 * has real line numbers), so there is no null/whole-file short-circuit here.
 */
function rangesIntersect(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA <= endB && endA >= startB;
}

/**
 * Whether two regions (from two sessions, in the same file) collide.
 * - If both name a symbol: collide iff they name the *same* symbol.
 * - Otherwise (at least one `symbolPath` is null): fall back to line-range intersection.
 * Returns the contested `symbolPath` (the shared symbol, or `null` for a line-range hit)
 * when they collide, or `undefined` when they do not.
 */
function regionsCollide(a: TouchedRegion, b: TouchedRegion): { symbolPath: string | null } | undefined {
  if (a.symbolPath !== null && b.symbolPath !== null) {
    return a.symbolPath === b.symbolPath ? { symbolPath: a.symbolPath } : undefined;
  }
  return rangesIntersect(a.startLine, a.endLine, b.startLine, b.endLine)
    ? { symbolPath: null }
    : undefined;
}

/**
 * Pure detector. Given the touched surfaces of all live sessions, return every distinct-session
 * overlap on a shared symbol (or intersecting line range when a symbol is unknown). Deterministic
 * and order-independent: each unordered session pair yields at most one overlap *per contested
 * region pair*, with `a` the lexicographically smaller session.
 *
 * Two distinct sessions overlap iff they each touch a region in the same file that collides
 * (same `symbolPath`, or — when either is null — intersecting `[startLine,endLine]`).
 */
export function detectSymbolOverlaps(surfaces: SessionSurface[]): SymbolOverlap[] {
  const out: SymbolOverlap[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < surfaces.length; i++) {
    for (let j = i + 1; j < surfaces.length; j++) {
      const sx = surfaces[i];
      const sy = surfaces[j];
      if (sx.sessionId === sy.sessionId) continue; // a session never overlaps itself

      // Orient so `a` is the lexicographically smaller session, matching the broker.
      const [low, high] = sx.sessionId < sy.sessionId ? [sx, sy] : [sy, sx];

      for (const ra of low.regions) {
        for (const rb of high.regions) {
          if (ra.filePath !== rb.filePath) continue;
          const hit = regionsCollide(ra, rb);
          if (!hit) continue;

          const overlap: SymbolOverlap = {
            filePath: ra.filePath,
            symbolPath: hit.symbolPath,
            a: { sessionId: low.sessionId, agentId: low.agentId, region: ra },
            b: { sessionId: high.sessionId, agentId: high.agentId, region: rb },
          };
          const key = symbolOverlapKey(overlap);
          if (seen.has(key)) continue; // collapse duplicate region pairs hitting the same symbol
          seen.add(key);
          out.push(overlap);
        }
      }
    }
  }
  return out;
}

/**
 * Stable dedup key for a symbol overlap: file + the unordered session pair + contested symbol.
 * Independent of the order sessions/regions were supplied, so re-scanning a standing overlap
 * produces the same key (the surfacing layer can treat it as idempotent).
 */
export function symbolOverlapKey(o: SymbolOverlap): string {
  const [s1, s2] = o.a.sessionId < o.b.sessionId
    ? [o.a.sessionId, o.b.sessionId]
    : [o.b.sessionId, o.a.sessionId];
  return `symbol-overlap:${o.filePath}:${s1}|${s2}:${o.symbolPath ?? '*'}`;
}
