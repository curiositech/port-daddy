# binder-aor-log: Cooperative Harbor implementation

Window: follows `2026-09-08-project-epistemology.md` through the operator's explicit
approval to implement the full Cooperative Harbor plan. Confidence: high in the
recorded authority boundaries; runtime completion is not established.

## Decisions and classifications

- **Authority / custody:** old blanket server-processing exclusion is superseded
  for explicitly consented managed shared projects only. ADR-0123 now records
  the service/operator trust boundary. Private/device-only mode remains.
- **Authority / records:** Chartroom plans and Harbor editing/execution have
  distinct owners and exact-revision references, recorded in ADR-0122.
- **Sequencing:** coordination-only managed hosting is expanded by the operator
  to the existing daemon/kernel on Cloudflare, with durable-before-ack recovery.
  ADR-0126 records the change. Marketplace/settlement remain deferred.
- **Schema:** identity-derived PeerIDs and path-derived channels are superseded
  design assumptions, not legitimate cross-device authority. Implementation and
  negative tests are owed; the capstone skill no longer recommends them.
- **Product:** roster-first interaction is superseded by project-first work;
  Epistemology is absorbed as an advisory workflow, not a competing program.
- **Shipped-vs-target:** all runtime, recovery, managed-hosting and measured
  predictive-benefit claims remain unproven. No coverage axis is marked complete.

## Accountable boundaries and gates

| Concern | Accountable role (not a launched agent) | Gate / evidence destination |
| --- | --- | --- |
| Architecture and roadmap identity | Architect of Record / Chartroom owner | ADR amendments and implementation ledger; live registry reconciliation held |
| Document/replica correctness | Harbor Editor owner | Concurrent-device, scope/path and authorship tests |
| Shared authority and custody | Harbor kernel / security owner | Admission, revocation, epoch fencing and recovery tests |
| Durable managed state | Remote Harbor owner | Crash injection before/after durable acknowledgement |
| Semantic utility | Epistemology owner | Held-out retrieval/similarity baselines; false alarms, misses, time and cost |
| Cross-surface usability | Native/web/iOS owners | Real screenshots, flow recording, a11y and human task tests |

All roles are responsibility labels, not assignments accepted by a person or
permission to spawn. Implementation progress and remaining gates are tracked in
[`cooperative-harbor-implementation.md`](../../../strategy/cooperative-harbor-implementation.md).
No Port Daddy calls, services, agents, paid inference or deployment are permitted.
The 2026-09-09 rerun of the bounded prior coverage spec remains `pass: false`,
score 40 (two unresolved landed-status contradictions, three incomplete axes).
Source changes resolve a design disagreement locally; mark it landed only after
the corresponding PR lands. Preserve the prior incomplete coverage verdict.
