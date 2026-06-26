/**
 * Surface scan — semantic conflict prediction from REAL edits (closes red-team S1).
 *
 * The claim-overlap detector (`lib/suggestion-broker.ts`) only sees conflicts an agent
 * VOLUNTARILY declared via `pd session files add`. This scan derives an agent's real
 * footprint from its **git diff** (`lib/surface-map.ts`), maps it to the code symbols it
 * touched, and runs the EXISTING rich conflict engine (`symbol-index.predictConflicts`).
 *
 * Why route through predictConflicts and not the new `surface-overlap` touched-region
 * intersection: per the semantic-conflict-prediction discipline, the dangerous conflicts
 * are the ones git merges clean but break the build — *signature* (A changes a function's
 * contract, B calls it), *dependency* (A modifies X, B reads X), *transitive* (A→…→B).
 * Those are found by the **dependency graph**, not by checking whether two agents touched
 * the same lines. `predictConflicts` already does the full taxonomy with claim types and
 * exponential distance-decay confidence; surface-overlap only does the Direct case. So the
 * integration's job is the *bridge* — real edits → symbol claims → the rich engine.
 *
 * Advisory by default (Port Daddy philosophy): conflicts surface as nudges, never a hard
 * block. Severity → confidence so a *blocking* conflict (direct/signature) routes through
 * the suggestions priority budget instead of competing with trivial overlaps.
 *
 * Pure conversion (`touchedRegionsToClaims`) is split from the IO orchestrator
 * (`runSurfaceScan`, deps injected) so the mapping is testable without a daemon — same
 * shape as `lib/suggestion-broker.ts`'s `runOverlapScan`.
 */

import { isAbsolute, join } from 'node:path';
import { parseUnifiedDiffHunks, computeTouchedRegions, type DiffHunk } from './surface-map.js';
import type { TouchedRegion } from './surface-map.js';
import type { Suggestions, SuggestionKind } from './suggestions.js';

/** A symbol an agent intends to read or modify — the shape `symbol-index.predictConflicts` consumes. */
export interface SymbolClaim {
  filePath: string;
  symbolPath: string;
  type: 'read' | 'modify';
}

/** One predicted conflict, as returned by `symbol-index.predictConflicts`. */
export interface ConflictPrediction {
  type: 'direct' | 'dependency' | 'signature' | 'transitive' | string;
  severity: 'blocking' | 'warning' | 'info';
  confidence: number;
  a: SymbolClaim;
  b: SymbolClaim;
  chain?: unknown;
}

/** Subset of `symbol-index` this scan needs (so it can be faked in tests). */
export interface SurfaceScanSymbolIndex {
  parseFile(filePath: string, content?: string): Promise<unknown>;
  getSymbols(filePath: string): Array<{ symbolPath: string; symbolType: string; startLine: number; endLine: number }>;
  predictConflicts(a: SymbolClaim[], b: SymbolClaim[]): ConflictPrediction[];
}

export interface SurfaceScanSession {
  sessionId: string;
  agentId: string | null;
  purpose: string;
  /** Absolute path to the session's worktree; sessions without one are skipped. */
  worktreePath: string | null;
}

export interface SurfaceScanInbox {
  send(agentId: string, content: unknown, options?: { from?: string; type?: string }): { success: boolean };
}

export interface SurfaceScanActivityLog {
  log(type: string, detail?: Record<string, unknown>): unknown;
}

export interface RunSurfaceScanDeps {
  sessions: SurfaceScanSession[];
  /** Injected so the real impl can shell `git -C <worktree> diff -U0` while tests use fixtures. */
  getDiff: (worktreePath: string) => string;
  symbolIndex: SurfaceScanSymbolIndex;
  suggestions: Suggestions;
  inbox: SurfaceScanInbox;
  activityLog?: SurfaceScanActivityLog;
}

/** Wire-format version of the surface-conflict payload (interchange hygiene — crosses
 *  inbox → CLI → MCP and may be read after the producing process is gone). */
export const SURFACE_CONFLICT_PAYLOAD_VERSION = 1 as const;

/** Reuse the shipped overlap kind until a dedicated `symbol-conflict-headsup` kind lands
 *  (a one-line addition to `lib/suggestions.ts`, deferred to avoid colliding with the
 *  in-flight priority-budget change to that file). */
const CONFLICT_KIND: SuggestionKind = 'claim-overlap-headsup';

/**
 * PURE: map an agent's touched regions (from its real git diff) to `modify` symbol claims.
 * Regions that matched no symbol (top-level / import-only edits) are dropped — those are
 * the file-level claim-overlap path's concern, not symbol-level conflict prediction.
 * Deduplicated by (file, symbol).
 */
export function touchedRegionsToClaims(regions: TouchedRegion[]): SymbolClaim[] {
  const seen = new Set<string>();
  const claims: SymbolClaim[] = [];
  for (const r of regions) {
    if (!r.symbolPath) continue;
    const key = `${r.filePath}::${r.symbolPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ filePath: r.filePath, symbolPath: r.symbolPath, type: 'modify' });
  }
  return claims;
}

/** Severity → confidence. A blocking conflict (direct/signature) lands at priority
 *  confidence so it bypasses the importance-blind hourly budget (red-team S5). */
export function severityToConfidence(severity: string): number {
  if (severity === 'blocking') return 0.97;
  if (severity === 'warning') return 0.9;
  return 0.6;
}

async function claimsForSession(s: SurfaceScanSession, deps: RunSurfaceScanDeps): Promise<SymbolClaim[]> {
  if (!s.worktreePath) return [];
  const diff = deps.getDiff(s.worktreePath);
  if (!diff || !diff.trim()) return [];

  const hunks = parseUnifiedDiffHunks(diff);
  const byFile = new Map<string, DiffHunk[]>();
  for (const h of hunks) {
    const arr = byFile.get(h.filePath);
    if (arr) arr.push(h);
    else byFile.set(h.filePath, [h]);
  }

  const symbolsByFile = new Map<string, Array<{ symbolPath: string; symbolType: string; startLine: number; endLine: number }>>();
  for (const file of byFile.keys()) {
    // The diff paths are relative to the session's WORKTREE — resolve against it so we
    // parse the worktree's edited copy, not whatever sits at the daemon's cwd. (A diff
    // that already yields absolute paths is used as-is.) Key by the relative `file` so
    // computeTouchedRegions matches the hunk paths.
    const resolved = isAbsolute(file) ? file : join(s.worktreePath, file);
    try {
      await deps.symbolIndex.parseFile(resolved);
    } catch {
      // unparseable / brand-new file → no symbols, falls through to whole-file (dropped)
    }
    symbolsByFile.set(file, deps.symbolIndex.getSymbols(resolved));
  }

  // computeTouchedRegions wants the symbol-index Symbol shape; getSymbols returns it.
  const regions = computeTouchedRegions(hunks, symbolsByFile as never);
  return touchedRegionsToClaims(regions);
}

export interface SurfaceScanResult {
  sessions: number;
  conflicts: number;
  surfaced: number;
  suppressed: number;
  delivered: number;
}

/**
 * Scan every active session's real edits, predict semantic conflicts pairwise via the
 * symbol-index dependency graph, and surface each to BOTH parties as an advisory nudge.
 * Re-scanning a standing conflict is a no-op until the suggestions cooldown lapses.
 */
export async function runSurfaceScan(deps: RunSurfaceScanDeps): Promise<SurfaceScanResult> {
  const active = deps.sessions.filter((s) => s.worktreePath);

  const claimsBySession = new Map<string, SymbolClaim[]>();
  for (const s of active) claimsBySession.set(s.sessionId, await claimsForSession(s, deps));

  let conflicts = 0;
  let surfaced = 0;
  let suppressed = 0;
  let delivered = 0;

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const A = active[i];
      const B = active[j];
      const ca = claimsBySession.get(A.sessionId) ?? [];
      const cb = claimsBySession.get(B.sessionId) ?? [];
      if (!ca.length || !cb.length) continue;

      for (const c of deps.symbolIndex.predictConflicts(ca, cb)) {
        conflicts++;
        const payloadHash =
          `surface-conflict:${c.type}:${A.sessionId}|${B.sessionId}` +
          `:${c.a.filePath}::${c.a.symbolPath}:${c.b.filePath}::${c.b.symbolPath}`;
        const confidence = severityToConfidence(c.severity);

        for (const [self, other, selfClaim, otherClaim] of [
          [A, B, c.a, c.b],
          [B, A, c.b, c.a],
        ] as [SurfaceScanSession, SurfaceScanSession, SymbolClaim, SymbolClaim][]) {
          const deliveryKey = self.agentId ?? self.sessionId;
          const who = other.agentId ?? other.sessionId;
          const payload = {
            v: SURFACE_CONFLICT_PAYLOAD_VERSION,
            kind: CONFLICT_KIND,
            conflictType: c.type,
            severity: c.severity,
            yourSymbol: `${selfClaim.filePath}::${selfClaim.symbolPath}`,
            theirSymbol: `${otherClaim.filePath}::${otherClaim.symbolPath}`,
            other: { sessionId: other.sessionId, agentId: other.agentId, purpose: other.purpose },
            message:
              `Semantic conflict (${c.severity} ${c.type}): your edit to ${selfClaim.symbolPath} ` +
              `conflicts with ${who}'s edit to ${otherClaim.symbolPath}. Reconcile before both land — git won't catch this.`,
          };

          const res = deps.suggestions.create({ agentId: deliveryKey, kind: CONFLICT_KIND, payload, payloadHash, confidence });
          if (!res.created) {
            suppressed++;
            deps.activityLog?.log('surface_conflict.suppressed', {
              agentId: deliveryKey,
              reason: res.reason,
              conflictType: c.type,
            });
            continue;
          }
          surfaced++;
          const sent = deps.inbox.send(deliveryKey, payload, { from: 'surface-scan', type: 'suggestion' });
          if (sent.success) delivered++;
          deps.activityLog?.log('surface_conflict.surfaced', {
            agentId: deliveryKey,
            conflictType: c.type,
            severity: c.severity,
            confidence,
          });
        }
      }
    }
  }

  return { sessions: active.length, conflicts, surfaced, suppressed, delivered };
}
