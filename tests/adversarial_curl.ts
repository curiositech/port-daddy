import { computeCoboundary } from "../src/coboundary.ts";
import type { SheafGraph } from "../src/sheaf_types.ts";

// Define the sheaf graph with a 3-agent cycle
const graph: SheafGraph = {
  edges: [
    { id: 'e0', u: 'A', v: 'B' },
    { id: 'e1', u: 'B', v: 'C' },
    { id: 'e2', u: 'C', v: 'A' }
  ]
};

// Define the stalks for each agent
const stalks = {
  A: [1],
  B: [2],
  C: [3]
};

// Compute coboundary residual
const result = computeCoboundary(graph, stalks);

// Calculate directed circulation
const circulation = (stalks.B[0] - stalks.A[0]) + (stalks.C[0] - stalks.B[0]) + (stalks.A[0] - stalks.C[0]);

console.log('Coboundary Residual:', result.residual);
console.log('Directed Circulation:', circulation);

// Demonstrate consistency and inconsistency
if (result.isConsensus) {
  console.log('The edges look consistent (acyclic tree).');
} else {
  console.log('The edges are inconsistent (closed cycle).');
}

// Check the curl
const curl = (stalks.B[0] - stalks.A[0]) + (stalks.C[0] - stalks.B[0]) + (stalks.A[0] - stalks.C[0]);
console.log('Curl:', curl);
if (curl !== 0) {
  console.log('Inconsistent cycle detected.');
} else {
  console.log('Consistent cycle detected.');
}