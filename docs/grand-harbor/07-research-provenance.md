# Research and repository provenance

**Status:** SOURCE MAP, NOT IMPLIED ACCEPTANCE

This ledger replaces ephemeral chat citations with durable repository permalinks and primary research sources. A source can motivate or constrain a proposal without becoming runtime authority.

## Authority snapshot

The repository was inspected at [`main@5e438c7`](https://github.com/curiositech/port-daddy/tree/5e438c7f932d26e6b313534fd6bc02dc472ba9e4). Source status in this table is part of the evidence:

| Source | Status at snapshot | What may be imported | What must not be claimed |
|---|---|---|---|
| [Convoy platform RFC](https://github.com/curiositech/port-daddy/blob/9a4f8a515acbf97fe6bf504702f665613e1221da/docs/design/convoy-platform-requirements.md) in [draft PR #9987](https://github.com/curiositech/port-daddy/pull/9987) | accepted revision within an unmerged draft PR; exact accepted revision [`31105d4`](https://github.com/curiositech/port-daddy/commit/31105d4fc819df323ce1315f6aa8471c49bf010a) | named `convoy` primitive; source → staged instance → signed release capsule → target → operation; contract-first staging; owner PWA after first compiler proof | Grand Harbor, Chartroom, action kernel, Cedar, or claim-tree requirements are not in the RFC body |
| [Grand Harbor addendum](https://github.com/curiositech/port-daddy/pull/9987#issuecomment-5504039547) | maintainer intake comment | single program authority direction; one hypertree; authority/identity/evidence critical path; causal vocabulary; surfaces as projections | merged/canonical Chartroom schema or production cutover |
| [Keystone action-adjudicator amendment](https://github.com/curiositech/port-daddy/pull/9987#issuecomment-5504065272) | maintainer intake comment | typed intent/permit/receipt direction; six correctness layers; offline compiler and zero-LLM hot path; Rust TCB constraint | selected policy engine, implemented generic kernel, or measured latency |
| [PR #9989 — Chartroom kernel](https://github.com/curiositech/port-daddy/pull/9989) | draft, unmerged | implementation candidate and explicit import/cutover prerequisites | production Chartroom authority or imported Grand Harbor ledger |
| [PR #9991 — Harbor Agent Runtime](https://github.com/curiositech/port-daddy/pull/9991) | open, approved, unshipped | provider-neutral runtime candidate | shipped runtime |
| [PR #9970 — universal Porthole stage](https://github.com/curiositech/port-daddy/pull/9970) | open, unmerged | evidence-stage direction | landed evidence explorer |
| [PR #9899 — iOS intent-first expansion](https://github.com/curiositech/port-daddy/pull/9899) | open; fixture-backed | native UX exploration | production live authority |
| [PR #9866 — runnable SwiftUI target](https://github.com/curiositech/port-daddy/pull/9866) | merged | runnable target and screenshot harness | complete intent-first product |

## Accepted and proposed repository decisions

| Record | Repository status | Relevance |
|---|---|---|
| [ADR-0022 — durable actor souls/body leases](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0022-durable-actor-souls-and-body-leases.md) | Accepted | identity persists beyond body/session |
| [ADR-0121 — durable agent roster](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0121-durable-agent-roster.md) | Accepted | `AgentNode` is the durable person |
| [ADR-0120 — Rust kernel boundary](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0120-rust-kernel-boundary.md) | Accepted | security primitives once in the Rust TCB |
| [ADR-0122 — Harbor authority](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0122-harbor-authority.md) | Accepted | intended Harbor/Chartroom authority relationships |
| [ADR-0125 — iOS operator surface](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0125-ios-operator-surface.md) | Accepted | native surface constraints |
| [ADR-0040 — non-forgeable actor identity](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0040-non-forgeable-actor-identity.md) | Proposed, with substantial implementation | partial identity substrate; never cite as accepted |
| [ADR-0038 — claim tree](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0038-claim-tree.md) | Proposed; implementation landed differently as Claim Forest | UX/topology motivation; preserve status drift |
| [Pheromone vocabulary v1](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/design/pheromone-vocabulary-v1.md) | Accepted design; downstream runtime exists in narrower form | decaying attention signals, not facts or authority |
| [ADR-0014 — Anchor protocol](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0014-the-anchor-protocol.md) | Accepted design; market/settlement incomplete | economic direction only |
| [ADR-0051 — marketplace protocol](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/adr/0051-marketplace-protocol.md) | Proposed | protected market hypothesis |

## Product and design constraints

- [Binder chapter 00](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/architecture/agent-harbor-technical-binder/00-prd-roadmap-and-test-plan.md) supplies roadmap and proof discipline.
- [Binder chapter 19](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/architecture/agent-harbor-technical-binder/19-operator-surface-triad.md) supplies the operator-surface relationships.
- [Binder chapter 20](https://github.com/curiositech/port-daddy/blob/5e438c7f932d26e6b313534fd6bc02dc472ba9e4/docs/architecture/agent-harbor-technical-binder/20-design-system-story-linework.md) supplies the Swiss-maritime hierarchy, fractional linework, semantic status color, IBM Plex typography, truthful live/stale/fixture states, accessibility, and remediation requirements used in the UX package.

## Cedar primary sources

The performance discussion in [14-performance-and-cedar.md](14-performance-and-cedar.md) relies on:

- [Cedar OOPSLA paper](https://arxiv.org/pdf/2403.04651), which benchmarks in-memory core authorization evaluation and explicitly excludes initialization, policy parsing, HTTP, and storage.
- [Official Cedar authorization semantics](https://docs.cedarpolicy.com/auth/authorization.html) and [security semantics](https://docs.cedarpolicy.com/other/security.html).
- Official best practices for [overview/schema validation](https://docs.cedarpolicy.com/bestpractices/bp-overview.html), [business/effect actions](https://docs.cedarpolicy.com/bestpractices/bp-map-actions.html), [policy scopes/indexing](https://docs.cedarpolicy.com/bestpractices/bp-populate-policy-scope.html), [context](https://docs.cedarpolicy.com/bestpractices/bp-using-the-context.html), and [input normalization](https://docs.cedarpolicy.com/bestpractices/bp-normalize-data-input.html).
- [Cedar level validation and entity slicing](https://docs.cedarpolicy.com/policies/level-validation.html), the [Cedar changelog](https://github.com/cedar-policy/cedar/blob/main/cedar-policy/CHANGELOG.md), and the experimental [local agent](https://github.com/cedar-policy/cedar-local-agent).
- AWS's [Lean verified-development report](https://aws.amazon.com/blogs/opensource/lean-into-verified-software-development/), which reports evaluator measurements separately from whole-model proof/compile time.

## Research principles imported

- BDI research supplies separation of beliefs, goals, accepted intentions, event/plan/intention selection, reconsideration, and persistent commitment. It does not require a literal AgentSpeak interpreter.
- FIPA interaction work supplies role-parameterized protocols, performatives, terminal and exception semantics. It does not imply reliable delivery, common knowledge, agreement, or incentive compatibility.
- Identity/reputation research supplies the forced dependency `non-forgeable identity → witnessed outcome → estimator/reputation → routing → market`.
- FORGE-style proof-carrying action work is useful motivation for typed, evidence-bound effects, but it does not establish this repository's runtime proof. See [FORGE](https://arxiv.org/html/2602.16708).

## Known provenance hazards

1. Roadmap metadata that says Claim Tree has “ZERO impl” is stale; Claim Forest writes/reads and UI surfaces exist.
2. Older Relay prose that says the system does not exist is stale; Relay v0 has a substantial tested implementation, though current deployment is not proved here.
3. The Porthole replay prototype and Agent Harbor event ledger are real, but their joined evidence-layer successor is not.
4. Skill-audit `ok` checks structure, not semantic grafting or whether every `pairs-with` target exists.
5. No chat message, including the archived synthesis, is an accepted decision merely because it is detailed.

