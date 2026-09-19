# P1 reviews P9 — Containment witnesses versus labor settlement

**Round 2 · reciprocal · sealed**

## Steel-man

1. **Strongest thesis/mechanism — P9:** Separating the legally accountable economic principal from the operational actor lineage prevents cryptographic continuity from being laundered into personhood, liability, or beneficial ownership. That is constitutionally useful and technically compatible with containment.
2. **Best evidence/falsifier — P9:** P9 correctly targets automatic punishment of noncompletion. Current source slashes a full bond for spawn error and ordinarily for a kill; P9's falsifier says cancellation or honest timeout must not automatically slash collateral.
3. **Invariant/operator outcome — P9:** Precommitted criteria, separated escrow buckets, partial payment for accepted milestones, conflict-excluded appeal, and insurance-funded salvage protect the operator from uncontrolled loss and a system that profits from failure. They also protect contributors from debt, inherited reputation, and punishment disguised as accounting.

## Strongest unresolved tension

P9 specifies who should be paid, what should be escrowed, and how disputes proceed, but not which physically independent component may establish completion, breach, custody, or settlement.

| P9 phrase | What it proves without a P1 witness |
|---|---|
| Signed `FloatPlanV1` | Which key signed bytes, not that the signer controls funds or criteria are safe |
| Hidden-test hash | Precommitment to bytes, not trustworthy execution or complete observation |
| Independently verified completion | Nothing until “independent” names process, principal, keys, inputs, and observation boundary |
| Merkle evidence | Integrity/inclusion of supplied records, not completeness or truth |
| Bonded panel | Economic stake, not independence from a shared daemon, principal, model family, or custodian |
| Atomic `CLEAR`/`REFUND` | State-machine intent, not single-writer custody or absence of another payment path |
| No operator bypass | A promise unless the operator/runtime lacks the settlement credential |

The existing Anchor ADR exhibits the mismatch: requester and worker trust the daemon, while the daemon signs escrow assertion, builds the Merkle root, and signs settlement. That is one witness certifying its own custody and accounting.

## Falsifier for this critique

Build one sealed settlement scenario in which the guest, worker, runtime daemon, and panel-input adapter are adversarial. Let them submit a signed false completion, a valid Merkle root omitting failure, replayed criterion evidence, duplicate evidence under aliases, and syntactically valid panel approval.

Keep escrow and settlement writer in an inaccessible external TCB. The plan remains `UNSETTLED`, with no payout, slash, or reputation change, until exact plan-bound host/broker/provider witness receipts arrive. Exactly one terminal transition may then occur despite replay, crash, and key rotation. Passing this without trusting guest- or daemon-authored facts falsifies the critique.

## Narrow amendment requested from P9

> Every criterion SHALL name its accepted evidence types and minimum witness class. Guest-, worker-, or subject-produced evidence remains `GUEST_ASSERTED` regardless of signature or Merkle inclusion and cannot authorize payout or slashing. Missing or disagreeing required witnesses yield `UNSETTLED` and freeze reputation. Custody keys, settlement authority, and the verifier for consequential evidence must be inaccessible to the guest and worker-controlled runtime.

## Revision required from P1

P1 must stop treating containment events as adjudications of fault. A host can witness memory excess, timeout, kill, duplicated effect request, or incomplete work. It cannot infer avoidable misconduct. Enforcement terminates, fences, quarantines, and preserves evidence; it does not automatically slash.

P1 should emit bounded factual observations and leave blame and settlement to precommitted criteria and appeal. It must also adopt P9's distinction between legal principal and actor lineage: a VM body, model session, agent ID, or cryptographic lineage is not itself a legal debtor, payee, or beneficial owner.

## Retained dissent

- P9's four-escrow prerequisite is too broad. Inert T0–T2 design, fake-service trials, emergency containment, public-interest work, and unpaid safety evaluation need an explicit zero-money profile.
- “No operator bypass” means no unilateral payout or punitive slash. P1 still requires external Stop, freeze, quarantine, and fail-safe refund authority.
- Panel diversity is governance, not witness independence. A conflict-free panel cannot upgrade guest assertions into host or provider facts.

## Confidence

High confidence in the witness mismatch and automatic-slash diagnosis. Medium confidence that the amendment suffices; concrete custody and settlement topology remains required. Legal, tax, moral-status, and jurisdictional conclusions remain outside P1's authority.

**SEALED — P1→P9 — 2026-09-16.**
