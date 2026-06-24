/**
 * Surface dispatch — DISPATCH-TIME conflict prevention (the prevention half of the
 * coordination layer).
 *
 * Today `predictConflicts` in `lib/symbol-index.ts` runs at MERGE time: it tells you
 * two change sets collided only after both agents already did the work. The region
 * claims in `lib/sessions.ts` are announced when an agent *begins*, but nothing checks
 * a NEW agent's intended surfaces against the already-held claims of OTHER live
 * sessions before that agent starts. This module closes that gap: given the surfaces an
 * agent is about to touch, it produces a pre-flight verdict (clear / warn / refuse) so a
 * collision is decomposed away at dispatch instead of reconciled after — the highest-
 * leverage coordination move (decomposition at dispatch beats conflict resolution).
 *
 * The overlap semantics here are a faithful mirror of `claimsConflict` /
 * `isWholeFileClaim` / `rangesOverlap` in `lib/sessions.ts` (the canonical source):
 *   - a null line range is a WHOLE-FILE claim and overlaps everything on that file;
 *   - two symbolPath claims collide iff they name the SAME symbolPath;
 *   - otherwise fall back to line-range intersection.
 * A session never conflicts with itself.
 *
 * Split, like `lib/suggestion-broker.ts`, into a PURE core (`preflightDispatch`,
 * trivially unit-testable, no DB/IO) and a thin deps-injected orchestrator
 * (`runPreflight`) that reads `sessions.listAllActiveClaims()` and delegates.
 */

/** One surface a newly-dispatched agent intends to touch. A null/absent line range
 *  means it intends to touch the WHOLE file (overlaps every claim on that file). */
export interface DispatchSurface {
  filePath: string;
  symbolPath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
}

/** One currently-held claim of another session, projected to the fields the
 *  pre-flight check needs (a subset of `sessions.listAllActiveClaims().claims`). */
export interface ActiveClaimLite {
  filePath: string;
  sessionId: string;
  agentId: string | null;
  symbolPath: string | null;
  startLine: number | null;
  endLine: number | null;
}

export type PreflightVerdict = 'clear' | 'warn' | 'refuse';

/** Why this verdict was reached for a `refuse`, surfaced for an agent-facing report. */
export type PreflightReason = 'same-symbol' | 'range-overlap' | 'whole-file';

export interface PreflightConflict {
  surface: DispatchSurface;
  heldBy: { sessionId: string; agentId: string | null; symbolPath: string | null };
  reason: PreflightReason;
}

export interface PreflightReport {
  verdict: PreflightVerdict;
  conflicts: PreflightConflict[];
  checkedSurfaces: number;
}

/**
 * Whether two line ranges intersect. A null endpoint marks a whole-file claim and
 * overlaps everything — identical semantics to `rangesOverlap` in `lib/sessions.ts`.
 */
function rangesOverlap(
  startA: number | null | undefined,
  endA: number | null | undefined,
  startB: number | null | undefined,
  endB: number | null | undefined,
): boolean {
  if (startA == null || endA == null || startB == null || endB == null) return true;
  return startA <= endB && endA >= startB;
}

/** Whole-file iff either endpoint is absent — matches `isWholeFileClaim` in sessions.ts. */
function isWholeFile(startLine: number | null | undefined, endLine: number | null | undefined): boolean {
  return startLine == null || endLine == null;
}

/**
 * Classify a single (intended surface, held claim) pair into a conflict reason, or
 * `null` if they do not collide. Mirrors `claimsConflict` in `lib/sessions.ts`:
 * whole-file dominates, then same-symbolPath, then line-range intersection.
 *
 * The reason returned is the STRONGEST applicable: a whole-file overlap reports
 * `whole-file`, two equal symbolPaths report `same-symbol`, and a plain line-range
 * intersection reports `range-overlap`. This ordering drives the verdict escalation.
 */
function classifyCollision(
  surface: DispatchSurface,
  claim: ActiveClaimLite,
): PreflightReason | null {
  const surfaceWhole = isWholeFile(surface.startLine, surface.endLine);
  const claimWhole = isWholeFile(claim.startLine, claim.endLine);

  if (surfaceWhole || claimWhole) return 'whole-file';

  if (surface.symbolPath && claim.symbolPath) {
    return surface.symbolPath === claim.symbolPath ? 'same-symbol' : null;
  }

  return rangesOverlap(surface.startLine, surface.endLine, claim.startLine, claim.endLine)
    ? 'range-overlap'
    : null;
}

/** A `refuse`-grade reason is a hard collision: same symbol or a whole-file claim. */
function isRefuseReason(reason: PreflightReason): boolean {
  return reason === 'same-symbol' || reason === 'whole-file';
}

/**
 * PURE pre-flight check. Given the surfaces a newly-dispatched agent intends to touch
 * and the currently-held claims of OTHER sessions, compute every conflict and a single
 * verdict:
 *   - `refuse`: at least one same-symbol or whole-file collision with a DISTINCT session
 *     (the agent should not be dispatched onto this surface as-is);
 *   - `warn`:   only soft (line-range) overlaps — proceed, but coordinate;
 *   - `clear`:  no conflicts.
 *
 * `selfSessionId`, when supplied, excludes that session's own claims so an agent re-
 * checking its own already-held surfaces never conflicts with itself. No DB/IO.
 *
 * @param intended       surfaces the new agent will touch (empty → always `clear`)
 * @param heldClaims      active claims across sessions (self is filtered by sessionId)
 * @param selfSessionId   the dispatching session's id, excluded from conflict matching
 */
export function preflightDispatch(
  intended: DispatchSurface[],
  heldClaims: ActiveClaimLite[],
  selfSessionId?: string,
): PreflightReport {
  const conflicts: PreflightConflict[] = [];

  // A session never conflicts with itself: drop self-owned claims up front.
  const otherClaims = selfSessionId
    ? heldClaims.filter(c => c.sessionId !== selfSessionId)
    : heldClaims;

  for (const surface of intended) {
    for (const claim of otherClaims) {
      if (claim.filePath !== surface.filePath) continue;
      const reason = classifyCollision(surface, claim);
      if (!reason) continue;
      conflicts.push({
        surface,
        heldBy: { sessionId: claim.sessionId, agentId: claim.agentId, symbolPath: claim.symbolPath },
        reason,
      });
    }
  }

  let verdict: PreflightVerdict = 'clear';
  if (conflicts.some(c => isRefuseReason(c.reason))) {
    verdict = 'refuse';
  } else if (conflicts.length > 0) {
    verdict = 'warn';
  }

  return { verdict, conflicts, checkedSurfaces: intended.length };
}

/** The slice of `lib/sessions.ts` the orchestrator needs (deps-injected, like the
 *  `SessionsClaimSource` in `lib/suggestion-broker.ts`). */
export interface PreflightSessionsSource {
  listAllActiveClaims(options?: Record<string, unknown>): {
    success: boolean;
    claims: Array<{
      filePath: string;
      sessionId: string;
      agentId: string | null;
      symbolPath: string | null;
      startLine: number | null;
      endLine: number | null;
    }>;
  };
}

export interface RunPreflightDeps {
  sessions: PreflightSessionsSource;
}

/**
 * Thin daemon-facing wrapper: read the live cross-session claims and run the pure
 * `preflightDispatch` against them. Deps are injected so the orchestration is tested
 * without a daemon (the `runOverlapScan` pattern in `lib/suggestion-broker.ts`).
 */
export function runPreflight(
  deps: RunPreflightDeps,
  intended: DispatchSurface[],
  selfSessionId?: string,
): PreflightReport {
  const res = deps.sessions.listAllActiveClaims();
  const held: ActiveClaimLite[] = res.success
    ? res.claims.map(c => ({
        filePath: c.filePath,
        sessionId: c.sessionId,
        agentId: c.agentId,
        symbolPath: c.symbolPath,
        startLine: c.startLine,
        endLine: c.endLine,
      }))
    : [];
  return preflightDispatch(intended, held, selfSessionId);
}
