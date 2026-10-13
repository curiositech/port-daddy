# RCP-3: a local proposal/refusal/revision sketch

RCP-3 is a local, constructed exchange and is not FIPA Contract Net conformance. It borrows familiar labels only to make messages reviewable.

| Step | Required local fields | Non-success branch |
|---|---|---|
| Broadcast | graph revision, candidate node IDs, evidence references | recipient cannot interpret the revision: record and hold |
| CFP | scope, output contract, deadline policy, capacity requirement, authority boundary | scope unclear: do not award; propose a new revision or use a separately defined iterative exchange |
| Proposal | candidate ID, accepted contract version, capacity statement, assumptions, evidence references | refusal names unavailable capacity or unsupported contract |
| Award/reject | selected proposal ID, rule, decision authority, resource check | no adequate proposal: hold/revise; do not delete contracts |
| Result | node ID, revision, status, evidence hash | failure, partial, missing, or untrusted stays non-success |
| Scope change | parent revision, changed contract/edge, descendant disposition | revalidate every successor or hold/prune it with a reason |

Smith (1980) supports manager/contractor task announcements, bids, awards, monitoring, and results. FIPA SC00029H supports CFP, refuse/not-understood/propose, accept/reject, then failure/inform reports. Neither source mandates highest-confidence selection, truthful confidence, retries, cancellation, or a fixed call budget. A renewed CFP after a scope change belongs nearer FIPA Iterated Contract Net SC00030; this bundle does not claim protocol conformance.
