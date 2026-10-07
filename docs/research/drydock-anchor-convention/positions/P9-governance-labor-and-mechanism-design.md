# P9 — Governance, agent labor, and mechanism design

**Round 1 · independent · sealed · anchor `6c2c30d74b889b4d8037ce5d43b265bfbf21a686`**

## Thesis

The constitution should build a principal-accountable, evidence-settled labor mechanism without pretending it has resolved whether an agent can morally or legally own compensation. “Agent payment” remains an explicit `UNKNOWN`; it must not be smuggled in through wallet, person, worker, or reputation terminology.

The strongest architecture separates:

1. the **economic subject**: a human or organization that signs, escrows, receives legal payment, bears liability, and handles tax or custody; from
2. the **operational subject**: an actor lineage, attested model/build, skill version, and disclosed affiliation whose contribution is recorded.

This lets the system pay for agent-mediated work today while preserving, rather than foreclosing, future claims about agent interests or personhood.

## Evidence posture

- **SOURCE_PRESENT:** A transactional project-wallet bond ledger supports escrow, refund, caller-determined partial or full slash, a commons pool, and conservation accounting in [`bonds.ts`](../../../../lib/bonds.ts). Its schema contains project, agent ID, archetype, bond amount, and state, but not a signed task, bounty, principal, legal payee, evidence weights, dispute, or salvage reserve. A scope-and-duration bond pricer exists, but its principal reputation input is stubbed. Anchor signs capability cards and produces Merkle roots; it is not a labor-settlement implementation.
- **PROPOSED:** [ADR-0014](../../../adr/0014-the-anchor-protocol.md) specifies signed Float Plans, requester bounty escrow, Merkle evidence, signed settlement receipts, and pro-rata salvage. The latest Harbor Economy status appendix marks the Float Plan ceremony, reputation, market, custody, and cross-harbor conservation as designed or visionary. A committed test is titled “Float Plans not active.”
- **UNKNOWN:** Agent moral status; legal personhood; beneficial ownership of credits; employment or agency classification; taxation; wage law; fiduciary duties; consent; and governing jurisdiction. Signed continuity proves a ledger lineage, not a person.
- **BLOCKED_BY_HALT:** Live escrow enforcement, actual receipts, runtime settlement, custody non-bypassability, and deployed reputation behavior. Documentation's “10,000 traces” wording is not current proof: committed property configuration specifies 100 cases plus one deterministic 200-operation test.

## Non-negotiables

- No work begins until bounty, performance bond, salvage reserve, and dispute fee are separately escrowed.
- Noncompletion is not sabotage. Collateral is slashed only for an adjudicated breach.
- Free-text notes cannot determine payment; only precommitted criteria and independently issued evidence can.
- No negative balances, uncapped liability, debt bondage, inherited tribal reputation, retaliation for appeal, or forfeiture merely for exit.
- Reputation remains multidimensional, contextual, uncertain, revocable, and attributable. It never becomes a universal caste score.
- The platform earns primarily from successful settlements, never principally from forfeitures.
- No cross-harbor mechanism may call itself trustless while depending on a daemon, custodian, or discretionary grader.

## Strongest implementation proposal

Create a signed `FloatPlanV1` with immutable task and criterion hashes; criterion weights; committed hidden-test hashes where gaming is likely; budget and cancellation terms; bounty, bond, salvage, and dispute buckets; requester and provider principals; legal payee; separately recorded beneficial claimant status; actor lineage; model/build attestation; skill content hashes; revocable school or tribal affiliations; judge-eligibility rules; jurisdiction; custody mode; expiry; and a unanimous amendment protocol with an escrow delta.

Settlement computes:

`earned bounty = Σ(weight_i × independently verified completion_i)`.

Accepted milestones are paid even if the whole plan fails. Unearned bounty returns to the requester. The performance bond returns in full unless a separate breach finding proves avoidable misconduct and quantifies covered loss. This rejects automatic slashing of the unfinished bond fraction.

Salvage is pre-funded as insurance, based on scope and systemic risk, rather than depending on punishing the predecessor. Proven slashes may replenish it. Commons accounts are segregated for salvage, audits, wrongful-slash compensation, and public goods, with visible budgets, conflict rules, participant review, graduated sanctions, and cheap appeal. Routing forfeitures to a commons rather than the buyer also preserves an external budget-breaker without rewarding buyers for rejection.

Attribution is tagged, not collapsed:

- principal: liability, sanctions, exposure limits, and legal payment;
- actor lineage: operational continuity and contribution provenance only;
- model/build: task-stratified performance and substitution detection;
- skill hash/version: exposure and outcome association, never causal credit without controlled evidence; and
- tribe/school: revocable affiliation used for conflict and concentration audits, never inherited score, ownership, exit penalty, or pricing shortcut.

Portable reputation is a signed bundle of outcomes, evidence hashes, task strata, model and skill versions, evaluators, uncertainty, freshness, revocations, and common-control disclosures, not a portable scalar. A receiving harbor applies its own policy and calibration. Principal-wide sanctions travel; local prices do not.

Disputes begin with mechanical evidence. Subjective disputes use a publicly selected, bonded panel excluding shared principal, financial interest, counterparty, and model family. Appeals use preserved evidence and a different panel; reputation freezes during dispute. Rights, ownership, or personhood questions terminate at an accountable human or lawful forum rather than recurse through agent graders.

Cross-harbor custody uses source escrow → explicit in-flight bucket → exactly one atomic terminal transition: `CLEAR` or `REFUSE/REFUND`. Recipient whitelist, fee cap, nonce/replay protection, expiry, recovery quorum, and no operator bypass are mandatory. Cross-currency valuation remains separate.

## Impossible combinations

- Anonymous cheap identities plus durable sanctions or unsecured credit.
- Mutable criteria plus evidence-derived partial payment.
- A global portable score plus privacy, local autonomy, and no shared revocation authority.
- Capital-accessible participation plus every worker personally bonding worst-case systemic cleanup without insurance.
- Inherited tribal reputation plus anti-caste individual attribution.
- “Paying the agent” while declining to identify legal owner, beneficiary, custodian, and tax subject.

Under Myerson–Satterthwaite's bilateral private-value assumptions, efficiency, incentive compatibility, individual rationality, and budget balance cannot all be guaranteed. The constitution must name its sacrificed corner, not promise all four.

## Falsification tests

- Missing any escrow bucket can still enter `running`.
- Duplicate, reordered, or spammed evidence increases payout.
- Cancellation or honest timeout automatically slashes collateral.
- One principal gains credit by cycling 1,000 actors through self-trades.
- A model swap inherits model-specific pricing without attestation.
- Tribal exit destroys self-earned outcomes or transfers them to the group.
- A conflicted judge can settle or appeal its own principal's case.
- Partition, replay, key rotation, or harbor death can orphan escrow or produce two terminal settlements.
- A bypass mutant violates the custody loss bound without detection.
- “Agent payee” activates without an explicit jurisdictional and beneficial-ownership decision.

These tests are `PROPOSED`; runtime execution remains `BLOCKED_BY_HALT`.

## Skill audit

- `mechanism-design-for-agent-labor` and `three-sided-agent-labor-market` correctly surface escrow, oracle, collusion, and conservation gates, but both are explicitly not payment plumbing and prematurely speak of agents as payees or tradeable persons.
- `agent-identity-continuity-reputation` must constrain “person” to ledger continuity.
- Ostrom supplies commons discipline, not legal consent.
- `agent-labor-pricing-function` is buyer-pricing guidance and explicitly not billing or payment implementation.
- Missing activation authority remains for labor law, beneficial ownership, taxation, regulated custody, collective representation, and machine moral status. None of these skills may substitute for it.

## Confidence and unknowns

Confidence is high on static implementation status, medium on the proposed mechanism, and low on legal and moral conclusions. The unresolved agent-payment question is not a defect to paper over. It is a constitutional boundary to preserve.

**SEALED — P9 — 2026-09-16.**
