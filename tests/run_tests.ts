import { computeCoboundary } from "../src/coboundary.ts";
import type { SheafGraph, StalkVector } from "../src/sheaf_types.ts";

// ---------------------------------------------------------------------------
// Test Case 1 (Consensus): 3 vertices A, B, C with edges A->B, B->C, A->C.
// All stalks are [1, 0] with identity restrictions, so the coboundary
// residual should be (essentially) zero.
// ---------------------------------------------------------------------------
const graph: SheafGraph = {
  vertices: ["A", "B", "C"],
  edges: [
    { id: "A->B", u: "A", v: "B" },
    { id: "B->C", u: "B", v: "C" },
    { id: "A->C", u: "A", v: "C" },
  ],
};

const consensusStalks: Record<string, StalkVector> = {
  A: [1, 0],
  B: [1, 0],
  C: [1, 0],
};

const res1 = computeCoboundary(graph, consensusStalks);
if (!(res1.residual < 1e-4)) {
  throw new Error(
    `TEST 1 CONSENSUS FAIL: expected residual < 1e-4 but got ${res1.residual}`,
  );
}
console.log("TEST 1 CONSENSUS PASS: residual is " + res1.residual);

// ---------------------------------------------------------------------------
// Test Case 2 (Discord): set the stalk of C to [0, 1]. This disagrees with
// A and B along edges B->C and A->C, so the residual should be large.
// ---------------------------------------------------------------------------
const discordStalks: Record<string, StalkVector> = {
  A: [1, 0],
  B: [1, 0],
  C: [0, 1],
};

const res2 = computeCoboundary(graph, discordStalks);
if (!(res2.residual > 0.1)) {
  throw new Error(
    `TEST 2 DISCORD FAIL: expected residual > 0.1 but got ${res2.residual}`,
  );
}
console.log("TEST 2 DISCORD PASS: detected residual " + res2.residual);
