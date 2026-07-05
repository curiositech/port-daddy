# Agent Identity / Continuity / Reputation Design Template

[One-sentence description of the fleet/system this design covers.]

## 1. Identity

- Minting authority: [daemon / server / other trusted substrate]
- Credential binding: [signing key / body-lease / other]
- Self-asserted display alias allowed: [yes/no — must never double as the reputation key]

## 2. Continuity

- Memory: [what persists, e.g. episodic-memory-algorithms stream]
- Checkpoint: [restorable execution/belief state, or "note-only" if that is
  the honest label]
- Outcome ledger: [append-only, externally-witnessed record of what was
  delivered — the field reputation actually keys on]

## 3. Outcome registration

- Oracle: [merged SHA / passing test id / released claim / satisfied monitor]
- Sampled adversarial auditor: [re-open rate, risk-weighting rule]

## 4. Reputation estimator

- Estimator: [elo | trueskill | bandit | none]
- Uncertainty representation: [TrueSkill variance / bandit exploration bonus / none]
- Gate wiring: [telemetry-only score + predicate gates, or explain why not]

## 5. Newcomer policy

- Floor: [full work eligibility, reduced ceiling until N clean exits]

## 6. Judge (if present)

- Present: [yes/no]
- De-biasing: [blind / order-swap / pairwise / family-exclude]

## 7. Sanctions

- Ladder: [graduated steps]
- Staking: [audit-failed-fake cost > honest-non-completion cost — show the numbers]

## Machine-checkable plan

```json
{
  "identityNonForgeable": false,
  "continuityPersists": {
    "memory": false,
    "checkpoint": false,
    "outcomeLedger": false
  },
  "outcomesCloseAgainstOracle": false,
  "sampledAdversarialAuditor": false,
  "estimator": "none",
  "representsUncertainty": false,
  "scoreIsTelemetryGatesArePredicates": false,
  "newcomerPolicy": false,
  "judge": {
    "present": false,
    "deBiased": false
  },
  "sanctionsStakedGraduated": false,
  "notes": "[free text: what is built vs. designed vs. missing, and why]"
}
```

Validate with `node scripts/reputation_soundness_audit.mjs --input <this-file-as-json>.json`
before treating any field above as true — the auditor will name the exact
chain-break (Sybil-reset, weak continuity, self-closed outcomes, reputation
wired to a gate, no newcomer policy, uncertainty-free estimator, un-de-biased
judge, unstaked sanctions) and fail the plan if `identityNonForgeable` or any
`high`-severity condition is unmet.

## Honest-ceiling caveat (state this explicitly in the finished design)

This design proves *delivery against an oracle on a clock the agent didn't
set*. It does **not** prove the work was *good*. Say so.
