# HTP structures: source method and proposed use

## What the primary source defines

Gui et al. (2025), §3.2, defines an HTP library `L=(G,q,R)`. A rule has a divisible start node and a set of child nodes. The constructed outline is rooted and acyclic; non-leaves must be rule starts and leaves belong to `G`. This is an LLM planning-outline representation, not a theorem about general task networks or query hypergraph width.

For `Plan -> {Route,Lodging}`, both labels form one child-set branch. That captures a decomposition choice. It does not state that Route and Lodging have no common budget, date, authority, or evidence dependency.

## Algorithmic use

Algorithm 1 (§4.2) repeatedly selects candidate hyperchains, filters when their count exceeds `W`, selects a divisible leaf in context, and instantiates an applicable rule. Its construction phase ends by selecting a final hyperchain as outline `O`. The paper then uses self-guided planning to develop content `C` and produces plan `P` (§4.3). See [htp-primary-method.md](htp-primary-method.md) for the complete source-labelled trace.

## Constructed outline check

Let `D={Plan,Route}` and add `Route -> {Route-A,Route-B}`. Expand Plan, then Route. Check that every internal node is a rule start, every leaf is in `G`, and no edge returns to an ancestor. Separately record `totalBudget` as a shared constraint. If Route-A and Lodging select incompatible costs, reject or revise a candidate; do not claim that the tree alone resolved the conflict.

## Transfer boundary

A deployment may use the outline to assign work, but must independently prove readiness, resource availability, effect authority, and integration. Parallel execution is a proposal that needs those checks; it is not supplied by the HTP source. Database hypertree decomposition instead uses bags and covering hyperedges with a width definition under query/CSP assumptions; its guarantees do not carry to this outline.
