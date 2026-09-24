---
name: three-sided-agent-labor-market
description: Design and review an explicitly modelled multi-party agent-labor market, including participation groups, cross-group effects, information and control boundaries, and settlement outcomes. NOT for payment plumbing, a pricing theorem, or an unverified escrow operation.
license: Apache-2.0
metadata:
  category: Research & Academic
  tags:
  - mechanism-design
  - multi-sided-platform
  - agent-marketplace
  - settlement-design
  - information-asymmetry
  provenance:
    kind: first-party
    owners:
    - port-daddy
  authorship:
    maintainers:
    - port-daddy
  io-contract:
    kind: deliverable
    produces:
      - kind: design-doc
        description: A model-bounded market worksheet with flows, assumptions, settlement states, and unresolved risks
---

# Three-sided agent-labor market design

“Three-sided” is a local modelling claim, not a count of logos, UI roles, incentive constraints, or reputation fields. Begin by naming the participation groups in the decision at hand, their outside options, their information, and the cross-group effects that matter. Only then decide whether a three-sided platform model is useful.

This skill preserves first-party ideas about operators, rented assets, skill licensing, float plans, and reputation as **proposals**. It does not claim they are economic theorems, deployed contract behavior, or a proven remedy for adverse selection.

## Model the groups before pricing

1. **List parties and roles.** A requester R may pay an operator O; O may rent a worker from owner W and license a skill from L; an intermediary P may charge a transaction fee.
2. **Choose the modelled groups.** State which roles share a participation decision and outside option for this decision. Five parties do not establish five sides. A shared legal identity does not itself collapse roles: one person may make separate buying and selling decisions. Aggregate roles only when a stated model justifies treating their participation decisions jointly; record what variation that aggregation discards.
3. **Draw four kinds of edge separately.** Record payments, control/authority, information/evidence, and reputation signals. A payment does not grant authority; an outcome signal does not prove quality.
4. **State cross-group effects and assumptions.** Name the counterfactual: holding total price fixed, would moving a charge from R to W change participation or volume? Also name multi-homing, platform competition, membership versus usage charges, and the price units.
5. **Select a pricing hypothesis, not a flip rule.** Rochet–Tirole’s two-sided model says price structure can matter when side-specific elasticities and cross-side effects matter. It does not say that scarce supply is always subsidized, or that a supply-to-demand flip follows automatically.
6. **Choose a settlement state model.** State who can produce evidence, decide a dispute, appeal, reverse a decision, and release funds. If the underlying float-plan/escrow contract and state machine have not been read, label the design a proposal.

### Hand check: roles are not sides

For the constructed example, draw R → O payment for delivered work; O → W lease payment; O → L license payment; and O → P transaction fee. Then record that R demand may affect W/L participation and W/L availability may affect R participation. This proves five parties and several flows; it does **not** prove a three-sided market.

A review can tentatively distinguish O, W, and L as participation groups only if the stated model supports that distinction and identifies their cross-group effects. Aggregating some roles instead needs a separate justification. If the evidence cannot support that, report “side count unresolved” and do not apply a multi-sided price result.

## Source-bounded economic lenses

| Lens | Supported question | Limit |
|---|---|---|
| Rochet & Tirole (2003) | Do price allocation, side elasticities, and cross-group effects change volume under named assumptions? | Its model is two-sided; it does not count local roles or select a subsidy side. |
| Grossman & Hart (1986) | How might residual control affect incentives when contracts omit contingencies? | It does not prescribe runtime revocation, reputation debits, or bonds. |
| Akerlof (1970) | Could hidden quality shrink trade under stated asymmetric-information assumptions? | It does not prove every skill market is lemons or prove metering/clawback remedies. |
| Chiu, Zhang & van der Schaar, arXiv:2512.04988v2 (2026) | What can a stylized capacity-constrained matching simulation illustrate? | Agents, jobs/clients, and platform rules are simulated; reputation is state/signal, not a third side or deployment evidence. |

See [the source ledger](references/01-primary-sources.md) and [method boundaries](references/02-first-party-proposal-boundary.md).

## First-party proposal: a float-plan settlement worksheet

Use the following only as a design worksheet until the actual contract and state machine are read. It is not a claim about shipped behavior.

| Field | Proposed meaning | Evidence/authority question |
|---|---|---|
| Float plan | task, acceptance criteria, budget ceiling, bounty, deadline policy | Who signs; which fields are versioned; what proves the current plan? |
| Held credits | bounty + bond + lease + license fee | Who funds each amount; can any amount be changed after acceptance? |
| Evidence | test receipt, delivery record, or reviewer finding | Who can submit it; how is provenance checked? |
| Decision | success, partial, failure, dispute, reversal, or collusion investigation | Which authority decides; is appeal possible; how is an earlier decision superseded? |
| Release | transfers and retained holds | What prevents double release after reversal or appeal? |
| Reputation signal | a separately scoped outcome annotation | Who may write it; can it be challenged; does it survive identity changes? |

### Constructed arithmetic hand check

Suppose bounty is 8 credits, bond is 2, lease is 1, and license fee is 0.5. Held amount is 8 + 2 + 1 + 0.5 = **11.5**. If a proposed 3% fee applies only to bounty, fee = 0.03 × 8 = **0.24** and net operator bounty = 8 − 0.24 = **7.76**. One proposed success transfer is:

| Recipient/purpose | Credits |
|---|---:|
| operator bounty after fee | 7.76 |
| return of bond to funder | 2.00 |
| asset lease | 1.00 |
| skill license | 0.50 |
| intermediary fee | 0.24 |
| **total** | **11.50** |

The arithmetic balances one constructed success row. It does not establish conservation across funding failure, partial completion, a false evaluator result, a dispute, reversal, collusion, or lost identity.

## Settlement outcomes: keep non-success distinct

| Outcome | Minimum record | Funds/reputation result that may be claimed |
|---|---|---|
| Success | accepted evidence, decision authority, decision version | Apply only the stated release rule. |
| Partial | delivered scope, omitted scope, assessment and authority | Hold/release allocation remains a policy choice; do not infer proportional payout. |
| Failure before work | plan acceptance, funding, and start/effect status recorded separately; failure can follow acceptance | Do not call it a completed task; return or retain funds only under the stated contract. |
| Failure after possible effect | evidence of attempted work and uncertainty | Preserve the unknown-effect state; do not silently retry or pay success. |
| Dispute | competing evidence, parties, reviewer authority, appeal window | Place disputed amounts on hold; a dispute is not sabotage. |
| Reversal | prior decision ID, new evidence, reversal authority | Create a superseding decision and prevent duplicate release. |
| Collusion allegation | parties, evidence, independent review path | Do not auto-slash from an allegation; preserve investigation and appeal. |

### Worked dispute and reversal

Use the 11.5-credit proposal above. A test evaluator reports success, so no transfer is final until its authority and evidence are recorded. W then supplies evidence that the worker’s output was evaluated against the wrong revision. Before any release, the state becomes **dispute**, and all 11.5 credits remain held. An authorised reviewer later reverses decision D17 with D18, records the corrected revision evidence, and chooses a partial-settlement rule. A valid ledger must show D17 superseded by D18 and exactly one release path. If a release already occurred, recording a reversal cannot put money back into escrow: record a separate authorised recovery or compensating transfer and any unrecovered deficit. This pre-release trace demonstrates evidence and accounting questions; it does not establish an oracle, appeal system, or a fair partial-payment formula.

## Diagnose the design, not the label

| Finding | Check | Repair |
|---|---|---|
| Phantom side | roles listed but no separate participation response/cross-group effect | collapse roles or mark the side count unresolved |
| Unsupported subsidy claim | “subsidize supply” asserted without elasticities, homing, price units, or counterfactual | record a testable local pricing hypothesis |
| Control leap | residual control theory is cited as a runtime permission | specify first-party authority and contract evidence separately |
| Lemons overreach | opaque skill is presumed low-quality | identify the asymmetric-information condition and a measurement plan |
| Reputation reification | reputation field called a market side | model it as signal/state unless a separate group/constraint is demonstrated |
| Premature success | dispatch or a single evaluator signal triggers settlement | require decision authority, evidence provenance, and a versioned state transition |
| Bond guarantee | bond/control right said to bound every loss | enumerate limits: appeal, evaluator error, collusion, insolvency, and identity failure |

## Diagrams and references

- [Group and flow modelling graph](diagrams/01-group-flow-model.md)
- [Settlement and dispute state machine](diagrams/02-settlement-states.md)
- [Primary source ledger](references/01-primary-sources.md)
- [First-party proposal boundary](references/02-first-party-proposal-boundary.md)
- [Worked settlement cases](references/03-worked-settlement-cases.md)
- [Market experiments and reputation evidence](references/04-market-experiment-worksheet.md)

## Historical provenance

The original skill and foundations reference are preserved as byte snapshots outside the active bundle. [Preimage record](provenance/ARCHIVAL-MATERIAL.md) provides canonical commit, source path, and SHA-256. This skill makes no Book novelty claim; the separate planning note records one possible explanatory figure question.
