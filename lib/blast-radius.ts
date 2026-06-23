/**
 * Blast radius — the reverse-dependency closure of a symbol.
 *
 * "If I change `SomeClass::someMethod`, what can break?" Answer: every symbol that
 * (transitively, up to a bounded depth) depends on it. `symbol-index.getDependents`
 * already gives the direct callers (reverse edges); this walks them breadth-first to
 * build the closure, so an agent can *reserve its blast radius* — declare a `modify`
 * on the target plus a `read` on everything downstream, holding callers stable while
 * it changes a contract (`blastRadiusToReadClaims`).
 *
 * Depth is capped (per the semantic-conflict-prediction discipline: beyond ~3-4 hops
 * everything traces back to `main()` and confidence is too low to act on). BFS reports
 * each node at its SHORTEST distance from the target.
 *
 * Pure over an injected `getDependents` so it's testable without the DB-backed index.
 */

/** One symbol in a target's blast radius, with how many hops away it is. */
export interface BlastRadiusNode {
  filePath: string;
  symbolPath: string;
  /** 1 = direct caller/dependent, 2 = its caller, … */
  distance: number;
  /** The edge kind that put it here at this distance. */
  via: string;
}

/** The reverse-edge query this needs — a structural subset of `symbol-index.getDependents`. */
export interface BlastRadiusDeps {
  getDependents(
    filePath: string,
    symbolPath?: string,
  ): Array<{ sourceFile: string; sourceSymbol: string | null; dependencyType: string }>;
}

export interface SymbolRef {
  filePath: string;
  symbolPath: string;
}

/**
 * Every symbol that depends on `target`, transitively, up to `maxDepth` hops.
 * File-level / unresolved dependents (no source symbol) are skipped — this is a
 * symbol-granular radius. Cycles and re-visits are de-duplicated; a node already
 * seen at a shorter distance is not re-reported.
 */
export function computeBlastRadius(
  deps: BlastRadiusDeps,
  target: SymbolRef,
  maxDepth = 3,
): BlastRadiusNode[] {
  const out: BlastRadiusNode[] = [];
  const seen = new Set<string>([`${target.filePath}::${target.symbolPath}`]);
  let frontier: SymbolRef[] = [target];

  for (let distance = 1; distance <= maxDepth && frontier.length > 0; distance++) {
    const next: SymbolRef[] = [];
    for (const node of frontier) {
      for (const d of deps.getDependents(node.filePath, node.symbolPath)) {
        if (!d.sourceSymbol) continue; // file-level / unresolved caller — not symbol-granular
        const key = `${d.sourceFile}::${d.sourceSymbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const caller: SymbolRef = { filePath: d.sourceFile, symbolPath: d.sourceSymbol };
        out.push({ ...caller, distance, via: d.dependencyType });
        next.push(caller);
      }
    }
    frontier = next;
  }

  return out;
}

export interface BlastClaim {
  filePath: string;
  symbolPath: string;
  type: 'read' | 'modify';
}

/**
 * Turn a target + its blast radius into a claim set: `modify` the target, `read`
 * everything downstream. Reserving these together is "I'm changing X's contract —
 * hold every caller stable until I'm done," which `symbol-index.predictConflicts`
 * then enforces as advisory conflicts against any other agent touching the radius.
 */
export function blastRadiusToReadClaims(target: SymbolRef, radius: BlastRadiusNode[]): BlastClaim[] {
  const claims: BlastClaim[] = [{ filePath: target.filePath, symbolPath: target.symbolPath, type: 'modify' }];
  const seen = new Set<string>([`${target.filePath}::${target.symbolPath}`]);
  for (const n of radius) {
    const key = `${n.filePath}::${n.symbolPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push({ filePath: n.filePath, symbolPath: n.symbolPath, type: 'read' });
  }
  return claims;
}
