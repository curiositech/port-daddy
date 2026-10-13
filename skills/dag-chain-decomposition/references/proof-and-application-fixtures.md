# Finite proof and application fixtures

All graphs below are constructed. They show an objective-specific proof shape; they do not establish resource allocation, deployment success, sensor correctness, or a runtime schedule.

## Exact chain versus direct-path cover

Graph `G1` has vertices `[a,x,b,c,d]` and arcs `a→x`, `x→b`, `c→x`, `x→d`.

For strict reachability, a maximum comparability matching can use `(a,x)`, `(x,b)`, and `(c,d)` because `c↝d` through `x`. Its size is 3, yielding `5-3=2` chains: `[[a,x,b],[c,d]]`. `a` and `c` are incomparable, so `['a','c']` is an antichain witness of size 2. Every vertex occurs once and each consecutive pair has a directed path.

For original arcs only, a maximum matching has size 2 because each left copy and each right copy participates in at most one matching edge. The same original vertex may appear once on each side, as x does along a path. Here all arcs meet either left-copy x or right-copy x, a size-2 vertex cover of the bipartite graph, while matching `(a,x),(x,b)` attains 2. It yields `5-2=3` direct paths. This difference is the objective distinction, not a scheduling result.

## Deployment graph: structural result and missing schedule evidence

Use direct arcs `db-dev→api-dev→verify-dev`, `db-stage→api-stage→verify-stage`, `verify-dev→promote-stage`, and `verify-stage→promote-prod`. The eight vertices admit chains `[db-dev,api-dev,verify-dev,promote-stage]` and `[db-stage,api-stage,verify-stage,promote-prod]`; both also use only direct arcs. The six successive pairs form a matching on left/right copies. The two incomparable initial database nodes certify width at least 2, matching this cover. Thus chain count and direct-path count are both exactly 2 for the declared graph. Record the graph revision and these witnesses. It cannot report a start time, worker count, or release outcome because durations, worker compatibility, environment locks, approval, authority, and completion evidence are absent.

Negative hand check: an output claiming `workers: 3` or a makespan from this graph alone is semantically invalid even though it can have valid JSON shape. Route that request to `dag-task-scheduler` with the missing contracts.

## Sensor graph: known vertices versus unresolved semantics

Known direct arcs are `ingest-temperature→quality-temperature→aggregate`, `ingest-vibration→quality-vibration→aggregate`, and `aggregate→alert`. There are six vertices. Chains `[ingest-temperature,quality-temperature,aggregate,alert]` and `[ingest-vibration,quality-vibration]` cover them exactly once. Four successive pairs form a matching, and the incomparable two ingest vertices certify minimum chain count 2; these chains also give minimum direct-path count 2. A verified partition contains only these named vertices. If “post-quality processing” is requested but no source, output, or edges are supplied, the existing six-node graph result remains valid, but return an incomplete proposal for the requested extended graph identifying that missing contract; do not manufacture a virtual node or claim a completed chain cover.

## Concatenation witness is not membership transfer

For the constructed direct-path cover `[[a,x,b],[c],[d]]` on G1, choose the iteration whose reverse lookup starts at `d`. Search incoming `x`; x is an interior member of `[a,x,b]`, not a current chain endpoint, so continue to incoming `c`, which is an endpoint. The witness is `c→x→d`. It establishes `c↝d`, allowing endpoint chains `[c]` and `[d]` to form reachability-chain `[c,d]`; x stays once in `[a,x,b]`. This search order is constructed to demonstrate the legal witness path and not claimed as the paper’s unspecified DFS tie order.
