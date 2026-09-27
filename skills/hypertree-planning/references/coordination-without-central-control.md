# Proposed transfer: using an HTP outline in a multi-worker system

## Status

HTP is not a multi-agent coordination protocol. The primary paper does not establish worker roles, message topology, parallel execution, task assignment, or a barrier/join algorithm. This reference is a **proposed transfer**, not an HTP result.

## Proposed routing procedure

1. Construct and review `O` using the source HTP procedure.
2. For each leaf, declare inputs, outputs, shared constraints, authority, and evidence requirements.
3. Create explicit dependency edges for facts or effects another leaf needs.
4. Admit work only after those dependencies and resources are available.
5. Integrate results against shared constraints and preserve rejected/unknown outcomes.

For `Plan -> {Route,Lodging}`, a route worker and lodging worker may be candidates for concurrent execution **only if** both receive the same budget/date contract, neither requires the other’s unproduced output, and their effects are permitted. A subsequent integration check can still reject one or both results.

## What this proposal does not claim

A shared outline does not remove the need for communication. It can provide a common vocabulary and a reviewable structure. It does not prove that a controller is unnecessary, that personas must be manual, or that HTP benchmark comparisons transfer to a particular multi-agent product.
