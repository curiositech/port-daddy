/**
 * Claim guard — real edits vs DECLARED symbol claims (function-claims revival, slice 1).
 *
 * The gap this closes: `runSurfaceScan` compares diff-derived claims of session A
 * against diff-derived claims of session B — it never consults `symbol_claims`. So
 * "agent A claims foo() via `claim_symbols`; agent B edits foo() without claiming"
 * went undetected unless A also happened to have a conflicting diff. This module
 * checks each session's REAL touched regions (from its git diff, via
 * `lib/surface-map.ts`) against every OTHER session's DECLARED active symbol claims.
 *
 * Two detection tiers:
 *  1. **symbol-identity** — convert the editor's touched regions to `modify` claims
 *     (the existing `touchedRegionsToClaims`) and run the EXISTING rich engine
 *     (`symbol-index.predictConflicts`) against the holder's declared claims. This
 *     reuses the full 4-way taxonomy (direct/dependency/signature/transitive) and
 *     the 6×6 claim-type matrix unchanged.
 *  2. **span-overlap** — for declared claims the identity tier could not match (the
 *     edited region resolved to no symbol: import/top-level edits, unparseable
 *     state, or symbolPath naming drift), look up the claimed symbol's REAL span
 *     (`symbols` table start/end lines, via `getSymbols`) and check inclusive-range
 *     intersection against the touched region's lines. A stale/renamed mapping
 *     still trips the wire on raw line spans.
 *
 * Freshness: every distinct claimed file is re-parsed (`parseFile`) before span
 * lookup — the SHA-256 parse cache (`parsed_files`) makes this a no-op when the
 * file is unchanged, so claimed spans are current without incremental refresh.
 * The EDITED side is already re-parsed by surface-scan's `claimsForSession`.
 *
 * PURE in the surface-scan sense: no DB, no IO of its own — the symbol index is
 * injected, so tests fake it. The runtime import of `touchedRegionsToClaims` from
 * surface-scan is a deliberate benign cycle (surface-scan imports this module's
 * `detectEditsAgainstClaims`); both are hoisted function declarations only touched
 * at call time, never during module evaluation.
 */

import { rangesOverlap, type TouchedRegion } from './surface-map.js';
import {
  touchedRegionsToClaims,
  type SymbolClaim,
  type ConflictPrediction,
  type SurfaceScanSymbolIndex,
} from './surface-scan.js';

/**
 * A claim another session DECLARED via `claim_symbols` / POST /sessions/:id/symbols.
 * `type` is the full claim taxonomy (read|modify|add-sibling|add-child|delete|rename),
 * wider than surface-scan's diff-derived read|modify — `predictConflicts` handles all.
 */
export interface DeclaredSymbolClaim {
  filePath: string;
  symbolPath: string;
  type: string;
}

export interface ClaimGuardHit {
  /** Same shape `symbol-index.predictConflicts` emits: a = the edit, b = the declared claim. */
  conflict: ConflictPrediction;
  /** Session that holds the declared claim being trodden on. */
  claimedBy: string;
  via: 'symbol-identity' | 'span-overlap';
}

/**
 * Diff paths are worktree-relative while declared claims are usually absolute
 * (and the symbols table stores resolved absolutes). Exact match, or a suffix
 * match when one side is the relative form of the other. Two DIFFERENT absolute
 * roots (e.g. two worktrees' copies of the same repo file) do NOT match — known
 * slice-1 limitation, same string-identity semantics `predictConflicts` uses.
 */
function samePath(a: string | null | undefined, b: string): boolean {
  if (!a) return false;
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

const claimKey = (c: { filePath: string; symbolPath: string }) => `${c.filePath}::${c.symbolPath}`;

/**
 * `predictConflicts` compares filePath by EXACT string equality, so a declared
 * claim in a different path form ("lib/a.ts" vs "/wt/lib/a.ts") would silently
 * miss the identity tier. Rewrite each declared claim onto the edit-side path
 * form when the two refer to the same file (suffix match), preferring the path
 * of a symbol-resolved region (the resolved absolute) over a raw-hunk relative.
 * The original declared path is kept for the freshness parse / span lookup.
 */
function normalizeDeclared(
  declared: DeclaredSymbolClaim[],
  touchedRegions: TouchedRegion[],
): Array<DeclaredSymbolClaim & { declaredFilePath: string }> {
  const editPaths = [
    ...touchedRegions.filter((r) => r.symbolPath !== null).map((r) => r.filePath),
    ...touchedRegions.filter((r) => r.symbolPath === null).map((r) => r.filePath),
  ];
  return declared.map((c) => {
    const match = editPaths.find((p) => samePath(p, c.filePath));
    return match && match !== c.filePath
      ? { ...c, filePath: match, declaredFilePath: c.filePath }
      : { ...c, declaredFilePath: c.filePath };
  });
}

/**
 * Check one editor session's real touched regions against every OTHER session's
 * declared symbol claims. Returns one hit per (holder, conflict) — the caller
 * (surface-scan) turns hits into suggestions/inbox nudges.
 */
export async function detectEditsAgainstClaims(
  editorSessionId: string,
  touchedRegions: TouchedRegion[],
  declaredBySession: Map<string, DeclaredSymbolClaim[]>,
  symbolIndex: SurfaceScanSymbolIndex,
): Promise<ClaimGuardHit[]> {
  const hits: ClaimGuardHit[] = [];
  if (!touchedRegions.length) return hits;

  const editClaims = touchedRegionsToClaims(touchedRegions);

  // Freshness: re-parse each distinct claimed file once (SHA-256 cache no-ops
  // unchanged files). Unparseable/missing files fall through to getSymbols
  // returning whatever the index last knew (possibly nothing).
  const claimedFiles = new Set<string>();
  for (const [holder, declared] of declaredBySession) {
    if (holder === editorSessionId) continue;
    for (const c of declared) claimedFiles.add(c.filePath);
  }
  for (const file of claimedFiles) {
    try {
      await symbolIndex.parseFile(file);
    } catch {
      // fail-soft: span tier just won't find a symbol for this file
    }
  }

  for (const [holderSessionId, declaredRaw] of declaredBySession) {
    if (holderSessionId === editorSessionId || !declaredRaw.length) continue;
    const declared = normalizeDeclared(declaredRaw, touchedRegions);

    // ── Tier 1: symbol identity → the existing full-taxonomy engine ──────────
    const identityHitKeys = new Set<string>();
    if (editClaims.length) {
      // Declared claims carry the full claim-type taxonomy; predictConflicts
      // accepts it (the SurfaceScanSymbolIndex facade is typed to the narrow
      // diff-derived read|modify, hence the cast).
      for (const c of symbolIndex.predictConflicts(editClaims, declared as SymbolClaim[])) {
        identityHitKeys.add(claimKey(c.b));
        hits.push({ conflict: c, claimedBy: holderSessionId, via: 'symbol-identity' });
      }
    }

    // ── Tier 2: raw span overlap — catches what identity missed ──────────────
    for (const claim of declared) {
      if (identityHitKeys.has(claimKey(claim))) continue;
      const sym =
        symbolIndex.getSymbols(claim.filePath).find((s) => s.symbolPath === claim.symbolPath) ??
        (claim.declaredFilePath !== claim.filePath
          ? symbolIndex.getSymbols(claim.declaredFilePath).find((s) => s.symbolPath === claim.symbolPath)
          : undefined);
      if (!sym) continue; // claim names a symbol the index can't span — nothing to check
      for (const region of touchedRegions) {
        if (!samePath(region.filePath, claim.filePath)) continue;
        // A same-symbol pair on the SAME (normalized) path is the identity tier's
        // territory: the 6×6 matrix already ruled there (possibly "safe" — do not
        // re-flag it here as blocking).
        if (region.symbolPath === claim.symbolPath && region.filePath === claim.filePath) continue;
        if (!rangesOverlap(region, sym)) continue;
        hits.push({
          conflict: {
            type: 'direct',
            severity: 'blocking',
            confidence: 1.0,
            a: {
              filePath: region.filePath,
              symbolPath: region.symbolPath ?? `<lines ${region.startLine}-${region.endLine}>`,
              type: 'modify',
            },
            b: { filePath: claim.declaredFilePath, symbolPath: claim.symbolPath, type: claim.type as SymbolClaim['type'] },
          },
          claimedBy: holderSessionId,
          via: 'span-overlap',
        });
        break; // one span hit per declared claim is enough signal
      }
    }
  }

  return hits;
}
