# Contract examples and negative cases

## Exact reachability-chain request

```json
{
  "graph": {
    "revision": "fixture-chain-vs-path-v1",
    "nodes": [{"id":"a"},{"id":"x"},{"id":"b"},{"id":"c"},{"id":"d"}],
    "edges": [{"from":"a","to":"x"},{"from":"x","to":"b"},{"from":"c","to":"x"},{"from":"x","to":"d"}]
  },
  "objective": "reachability-chain-partition",
  "semanticRequirements": {"uniqueNodeIds": true, "edgeEndpointsExist": true, "acyclic": true},
  "validationScope": "exact"
}
```

The verified output records nonempty chains `[["a","x","b"],["c","d"]]`, a strict-closure matching size of 3, antichain witness `["a","c"]`, and semantic checks that every ID is unique, every endpoint exists, the graph is acyclic, every chain adjacency is reachable, and the witness is incomparable. JSON Schema can check shape but not those facts.

```json
{
  "objective": "reachability-chain-partition",
  "graphRevision": "fixture-chain-vs-path-v1",
  "status": "verified",
  "chains": [["a", "x", "b"], ["c", "d"]],
  "matchingSize": 3,
  "antichainWitness": ["a", "c"],
  "semanticChecks": {
    "uniqueNodeIds": true,
    "edgeEndpointsExist": true,
    "acyclic": true,
    "coverageExactlyOnce": true,
    "adjacentPairsValid": true,
    "antichainIncomparable": true
  },
  "boundaries": ["Strict reachability chain partition; not a schedule."]
}
```

## Rejections and incomplete outputs

- Reject `{ "dag": {} }`: the contract requires graph revision, nonempty nodes, and each edge endpoint.
- Reject a direct-edge path-cover request that supplies a reachability-chain witness as though it used original arcs.
- Mark validation `incomplete` when closure/matching or an antichain witness is absent; do not populate a meaningless compression ratio.
- For a weighted schedule, return `status: "unsupported"` and `route: "dag-task-scheduler"`; do not serialize a width witness as a schedule result.
