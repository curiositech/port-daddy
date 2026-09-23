import type { SheafGraph, StalkVector, CoboundaryResult } from "./sheaf_types.ts";

/**
 * Compute the coboundary residual of a sheaf graph given stalk vectors.
 *
 * For each edge u -> v, the coboundary measures the disagreement between
 * the stalk at u (transported by the restriction map) and the stalk at v.
 * With identity restrictions this reduces to the squared Euclidean distance
 * between the two stalk vectors.
 */
export function computeCoboundary(
  graph: SheafGraph,
  stalks: Record<string, StalkVector>,
): CoboundaryResult {
  const edgeResiduals: Record<string, number> = {};
  let residual = 0;

  for (const edge of graph.edges) {
    const u = stalks[edge.u];
    const v = stalks[edge.v];
    if (!u || !v) {
      throw new Error(`Missing stalk for edge ${edge.id} (${edge.u} -> ${edge.v})`);
    }
    const dim = Math.max(u.length, v.length);
    let sq = 0;
    for (let i = 0; i < dim; i++) {
      const a = u[i] ?? 0;
      const b = v[i] ?? 0;
      const d = a - b;
      sq += d * d;
    }
    edgeResiduals[edge.id] = sq;
    residual += sq;
  }

  return {
    residual,
    edgeResiduals,
    isConsensus: residual < 1e-4,
  };
}
